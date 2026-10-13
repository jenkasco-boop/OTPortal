using System.Globalization;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using OtPortal.Api.Domain;

namespace OtPortal.Api.Export;

/// <summary>
/// Template rules (see docs/excel-template.md):
///  - Any cell (and the sheet name) may contain header tokens: {{NAME_TH}} {{NAME_EN}} {{YYMM}} {{MONTH_TH}} {{MONTH_EN}}
///    {{MONTH_NAME_EN}} {{TOTAL_OT10}} {{TOTAL_OT15}} {{TOTAL_OT30}} {{TOTAL_OTX}}
///  - One row holds line tokens such as {{row.No}} {{row.Date}} {{row.Ot15}}; that row is repeated once per OT line.
///  - Optionally another row holds request tokens such as {{req.Project}} {{req.Detail}}; repeated once per entry.
/// </summary>
/// <param name="templateFile">Full path to the .xlsx template. If the file is missing a plain sheet is generated.</param>
public sealed partial class ExcelExporter(string templateFile)
{
    public static readonly (string Header, string Field)[] Columns =
    [
        ("No", "No"), ("ชื่อ-นามสกุล", "Name"), ("พิเศษ", "Special"), ("วัน", "Day"), ("วันที่", "Date"),
        ("เข้า", "TimeIn"), ("ออก", "TimeOut"), ("เวลาเข้า-ออก", "Duration"), ("ชั่วโมง", "Hours"), ("นาที", "Minutes"),
        ("พัก", "BreakMinutes"), ("นาทีรวม", "NetMinutes"), ("OT 1.0", "Ot10"), ("OT 1.5", "Ot15"), ("OT 3.0", "Ot30"),
        ("OTxTime", "OtxTime"), ("หมายเหตุ", "Remark"), ("รับทราบ", "Approve"),
    ];

    [GeneratedRegex(@"\{\{\s*([A-Za-z0-9_.]+)\s*\}\}")]
    private static partial Regex TokenRegex();

    public byte[] Export(OtMonthReport report)
    {
        var useTemplate = File.Exists(templateFile);
        using var wb = useTemplate ? new XLWorkbook(templateFile) : BuildDefaultWorkbook();
        var ws = wb.Worksheet(1);

        FillRows(ws, "req", report.Requests, RequestValue);
        var lineRows = FillRows(ws, "row", report.Lines, LineValue);
        FillHeaderTokens(ws, report);
        if (!useTemplate && lineRows is var (first, last)) ws.Columns().AdjustToContents(first - 1, last + 1);

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    private static XLWorkbook BuildDefaultWorkbook()
    {
        var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("OT");
        ws.Style.Font.FontName = "Tahoma";
        ws.Style.Font.FontSize = 10;

        ws.Cell(1, 1).Value = "รายงาน OT {{NAME_TH}} ({{NAME_EN}}) เดือน {{MONTH_TH}}";
        ws.Cell(1, 1).Style.Font.Bold = true;

        for (var c = 0; c < Columns.Length; c++)
        {
            ws.Cell(3, c + 1).Value = Columns[c].Header;
            ws.Cell(4, c + 1).Value = $"{{{{row.{Columns[c].Field}}}}}";
        }
        var header = ws.Range(3, 1, 3, Columns.Length);
        header.Style.Font.Bold = true;
        header.Style.Fill.BackgroundColor = XLColor.FromHtml("#DDEBF7");
        header.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        ws.Range(3, 1, 4, Columns.Length).Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        ws.Range(3, 1, 4, Columns.Length).Style.Border.InsideBorder = XLBorderStyleValues.Thin;

        var total = ws.Cell(5, 12);
        total.Value = "รวม";
        total.Style.Font.Bold = true;
        ws.Cell(5, 13).Value = "{{TOTAL_OT10}}";
        ws.Cell(5, 14).Value = "{{TOTAL_OT15}}";
        ws.Cell(5, 15).Value = "{{TOTAL_OT30}}";
        ws.Cell(5, 16).Value = "{{TOTAL_OTX}}";
        ws.Range(5, 13, 5, 16).Style.Font.Bold = true;
        return wb;
    }

    /// <summary>Repeats the row holding <c>{{prefix.*}}</c> tokens once per item. Returns the filled row range.</summary>
    private static (int First, int Last)? FillRows<T>(IXLWorksheet ws, string prefix, IReadOnlyList<T> items,
        Func<T, string, object?> value)
    {
        var marker = "{{" + prefix + ".";
        var templateRow = ws.RowsUsed().FirstOrDefault(r => r.CellsUsed().Any(c => c.GetString().Contains(marker)));
        if (templateRow is null) return null;

        var tokens = templateRow.CellsUsed().Where(c => c.GetString().Contains(marker))
            .ToDictionary(c => c.Address.ColumnNumber, c => c.GetString());
        var firstRow = templateRow.RowNumber();

        if (items.Count == 0)
        {
            foreach (var col in tokens.Keys) ws.Cell(firstRow, col).Value = Blank.Value;
            return null;
        }
        if (items.Count > 1) templateRow.InsertRowsBelow(items.Count - 1);

        for (var i = 0; i < items.Count; i++)
        foreach (var (col, text) in tokens)
            SetCell(ws.Cell(firstRow + i, col), text, field => value(items[i], field));

        return (firstRow, firstRow + items.Count - 1);
    }

    private static void FillHeaderTokens(IXLWorksheet ws, OtMonthReport r)
    {
        var date = new DateTime(r.Year, r.Month, 1);
        var th = new CultureInfo("th-TH");
        object? Header(string token) => token switch
        {
            "NAME_TH" => r.Employee.NameTh,
            "NAME_EN" => r.Employee.NameEn,
            "YYMM" => $"{r.Year % 100:00}{r.Month:00}",
            "MONTH_TH" => date.ToString("MMMM yyyy", th),
            "MONTH_EN" => date.ToString("MMMM yyyy", CultureInfo.InvariantCulture),
            "MONTH_NAME_EN" => date.ToString("MMMM", CultureInfo.InvariantCulture),
            "TOTAL_OT10" => r.Totals.Ot10,
            "TOTAL_OT15" => r.Totals.Ot15,
            "TOTAL_OT30" => r.Totals.Ot30,
            "TOTAL_OTX" => r.Totals.OtxTime,
            _ => null,
        };

        foreach (var cell in ws.CellsUsed(c => c.DataType == XLDataType.Text && c.GetString().Contains("{{")))
            SetCell(cell, cell.GetString(), Header);

        var sheetName = TokenRegex().Replace(ws.Name, m => Convert.ToString(Header(m.Groups[1].Value), CultureInfo.InvariantCulture) ?? m.Value);
        if (sheetName != ws.Name) ws.Name = sheetName[..Math.Min(sheetName.Length, 31)];
    }

    /// <summary>A cell that is exactly one token keeps the value's type (number/date); otherwise tokens are replaced as text.</summary>
    private static void SetCell(IXLCell cell, string text, Func<string, object?> resolve)
    {
        var match = TokenRegex().Match(text);
        if (!match.Success) return;

        if (match.Value == text.Trim())
        {
            var value = resolve(FieldName(match.Groups[1].Value));
            if (value is not null) cell.Value = ToCellValue(value);
            return;
        }

        cell.Value = TokenRegex().Replace(text, m =>
            resolve(FieldName(m.Groups[1].Value)) is { } v ? Convert.ToString(v, CultureInfo.InvariantCulture) ?? "" : m.Value);
    }

    /// <summary>"row.Date" / "req.Date" → "Date"; header tokens have no prefix.</summary>
    private static string FieldName(string token) => token[(token.IndexOf('.') + 1)..];

    private static XLCellValue ToCellValue(object value) => value switch
    {
        int i => i,
        decimal d => d,
        DateOnly d => d.ToDateTime(TimeOnly.MinValue),
        _ => value.ToString(),
    };

    private static object? LineValue(OtLine l, string field) => field switch
    {
        "No" => l.No,
        "Name" => l.Name,
        "Project" => l.Project,
        "Special" => l.Special,
        "Day" => l.Day,
        "Date" => l.Date.ToString("dd/MM/yyyy"),
        "TimeIn" => l.TimeIn,
        "TimeOut" => l.TimeOut,
        "Duration" => l.Duration,
        "Hours" => l.Hours,
        "Minutes" => l.Minutes,
        "BreakMinutes" => l.BreakMinutes,
        "NetMinutes" => l.NetMinutes,
        "Ot10" => l.Ot10,
        "Ot15" => l.Ot15,
        "Ot30" => l.Ot30,
        "OtxTime" => l.OtxTime,
        "Remark" => l.Remark,
        "Approve" => "",
        _ => null,
    };

    private static object? RequestValue(OtRequestLine r, string field) => field switch
    {
        "No" => r.No,
        "Name" => r.Name,
        "Project" => r.Project,
        "Detail" => r.Detail,
        "Date" => r.Date.ToString("dd/MM/yyyy"),
        _ => null,
    };
}
