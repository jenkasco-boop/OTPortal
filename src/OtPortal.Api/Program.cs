using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using OtPortal.Api.Data;
using OtPortal.Api.Domain;
using OtPortal.Api.Export;

var builder = WebApplication.CreateBuilder(args);

var dbPath = Path.Combine(builder.Environment.ContentRootPath, builder.Configuration["Database:Path"] ?? "App_Data/otportal.db");
Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
builder.Services.AddDbContext<AppDb>(o => o.UseSqlite($"Data Source={dbPath}"));
var templateFile = Path.Combine(builder.Environment.ContentRootPath, builder.Configuration["Export:TemplatePath"] ?? "Templates/ot-template.xlsx");
builder.Services.AddSingleton(new ExcelExporter(templateFile));
builder.Services.AddProblemDetails();
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
    scope.ServiceProvider.GetRequiredService<AppDb>().Database.EnsureCreated();

app.UseExceptionHandler();
app.UseDefaultFiles();
app.UseStaticFiles();

var api = app.MapGroup("/api");

// ---------- Employees ----------
api.MapGet("/employees", (AppDb db) => db.Employees.OrderBy(e => e.NameEn).ToListAsync());

api.MapPost("/employees", async (EmployeeDto dto, AppDb db) =>
{
    if (Validate(dto) is { } err) return err;
    var e = new Employee { NameEn = dto.NameEn.Trim().ToUpperInvariant(), NameTh = dto.NameTh.Trim(), DefaultBreakMinutes = dto.DefaultBreakMinutes };
    if (await db.Employees.AnyAsync(x => x.NameEn == e.NameEn))
        return Results.Problem($"มีชื่อ {e.NameEn} อยู่แล้ว", statusCode: 409);
    db.Employees.Add(e);
    await db.SaveChangesAsync();
    return Results.Ok(e);
});

api.MapPut("/employees/{id:int}", async (int id, EmployeeDto dto, AppDb db) =>
{
    if (Validate(dto) is { } err) return err;
    var e = await db.Employees.FindAsync(id);
    if (e is null) return Results.NotFound();
    e.NameEn = dto.NameEn.Trim().ToUpperInvariant();
    e.NameTh = dto.NameTh.Trim();
    e.DefaultBreakMinutes = dto.DefaultBreakMinutes;
    await db.SaveChangesAsync();
    return Results.Ok(e);
});

// ---------- Holidays ----------
api.MapGet("/holidays", (int? year, AppDb db) =>
    db.Holidays.Where(h => year == null || h.Date.Year == year).OrderBy(h => h.Date).ToListAsync());

api.MapPost("/holidays", async (List<Holiday> items, AppDb db) =>
{
    foreach (var h in items)
    {
        var existing = await db.Holidays.FindAsync(h.Date);
        if (existing is null) db.Holidays.Add(h);
        else existing.Name = h.Name;
    }
    await db.SaveChangesAsync();
    return Results.NoContent();
});

api.MapDelete("/holidays/{date}", async (DateOnly date, AppDb db) =>
{
    await db.Holidays.Where(h => h.Date == date).ExecuteDeleteAsync();
    return Results.NoContent();
});

// ---------- OT entries ----------
api.MapPost("/preview", async (EntryDto dto, AppDb db) =>
{
    var holidays = await HolidaySet(db, dto.Date, dto.Date.AddDays(1));
    return Results.Ok(Calculate(dto, holidays));
});

api.MapGet("/entries", async (int employeeId, string month, AppDb db) =>
{
    if (!TryParseMonth(month, out var from)) return Results.BadRequest("month must be yyyy-MM");
    var to = from.AddMonths(1);
    var entries = await db.Entries.Where(e => e.EmployeeId == employeeId && e.Date >= from && e.Date < to)
        .OrderBy(e => e.Date).ThenBy(e => e.Start).ToListAsync();
    var holidays = await HolidaySet(db, from, to.AddDays(1));
    return Results.Ok(entries.Select(e => new
    {
        e.Id, e.Date, e.Start, e.End, e.BreakMinutes, e.Support, e.Remark,
        Result = OtCalculator.Calculate(e.Date, e.Start, e.End, e.BreakMinutes, e.Support, holidays.Contains),
    }));
});

api.MapPost("/entries", async (EntryDto dto, AppDb db) =>
{
    if (!await db.Employees.AnyAsync(e => e.Id == dto.EmployeeId)) return Results.BadRequest("ไม่พบพนักงาน");
    var holidays = await HolidaySet(db, dto.Date, dto.Date.AddDays(1));
    if (!Calculate(dto, holidays).HasOt) return Results.Problem("ไม่พบ OT ในช่วงเวลาที่กำหนด", statusCode: 400);

    var entry = new OtEntry();
    Apply(entry, dto);
    db.Entries.Add(entry);
    await db.SaveChangesAsync();
    return Results.Ok(entry);
});

api.MapPut("/entries/{id:int}", async (int id, EntryDto dto, AppDb db) =>
{
    var entry = await db.Entries.FindAsync(id);
    if (entry is null) return Results.NotFound();
    var holidays = await HolidaySet(db, dto.Date, dto.Date.AddDays(1));
    if (!Calculate(dto, holidays).HasOt) return Results.Problem("ไม่พบ OT ในช่วงเวลาที่กำหนด", statusCode: 400);
    Apply(entry, dto);
    await db.SaveChangesAsync();
    return Results.Ok(entry);
});

api.MapDelete("/entries/{id:int}", async (int id, AppDb db) =>
{
    await db.Entries.Where(e => e.Id == id).ExecuteDeleteAsync();
    return Results.NoContent();
});

// ---------- Report / export ----------
api.MapGet("/report", async (int employeeId, string month, AppDb db) =>
    await BuildReport(employeeId, month, db) is { } r ? Results.Ok(r) : Results.NotFound());

api.MapGet("/export", async (int employeeId, string month, AppDb db, ExcelExporter exporter) =>
{
    var report = await BuildReport(employeeId, month, db);
    if (report is null) return Results.NotFound();
    return Results.File(exporter.Export(report),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", report.FileName + ".xlsx");
});

app.MapFallbackToFile("index.html");
app.Run();

// ---------- helpers ----------
static IResult? Validate(EmployeeDto dto) =>
    string.IsNullOrWhiteSpace(dto.NameEn) || string.IsNullOrWhiteSpace(dto.NameTh) ? Results.BadRequest("กรุณาระบุชื่อ")
    : !dto.NameEn.Trim().All(c => char.IsAsciiLetterOrDigit(c) || c == ' ') ? Results.BadRequest("ชื่อ EN ใช้ได้เฉพาะ A-Z และ 0-9")
    : dto.DefaultBreakMinutes < 0 ? Results.BadRequest("เวลาพักต้องไม่ติดลบ")
    : null;

static OtResult Calculate(EntryDto dto, HashSet<DateOnly> holidays) =>
    OtCalculator.Calculate(dto.Date, dto.Start, dto.End, Math.Max(0, dto.BreakMinutes), dto.Support, holidays.Contains);

static void Apply(OtEntry entry, EntryDto dto)
{
    entry.EmployeeId = dto.EmployeeId;
    entry.Date = dto.Date;
    entry.Start = dto.Start;
    entry.End = dto.End;
    entry.BreakMinutes = Math.Max(0, dto.BreakMinutes);
    entry.Support = dto.Support;
    entry.Remark = string.IsNullOrWhiteSpace(dto.Remark) ? null : dto.Remark.Trim();
}

static async Task<HashSet<DateOnly>> HolidaySet(AppDb db, DateOnly from, DateOnly toInclusive) =>
    (await db.Holidays.Where(h => h.Date >= from && h.Date <= toInclusive).Select(h => h.Date).ToListAsync()).ToHashSet();

static bool TryParseMonth(string month, out DateOnly first) =>
    DateOnly.TryParseExact(month + "-01", "yyyy-MM-dd", out first);

static async Task<OtMonthReport?> BuildReport(int employeeId, string month, AppDb db)
{
    if (!TryParseMonth(month, out var from)) return null;
    var employee = await db.Employees.FindAsync(employeeId);
    if (employee is null) return null;
    var to = from.AddMonths(1);
    var entries = await db.Entries.Where(e => e.EmployeeId == employeeId && e.Date >= from && e.Date < to).ToListAsync();
    var holidays = await HolidaySet(db, from, to.AddDays(1));
    return OtReport.Build(employee, from.Year, from.Month, entries, holidays.Contains);
}

public record EmployeeDto(string NameEn, string NameTh, int DefaultBreakMinutes);
public record EntryDto(int EmployeeId, DateOnly Date, TimeOnly Start, TimeOnly End, int BreakMinutes, bool Support, string? Remark);
