using Microsoft.EntityFrameworkCore;

namespace OtPortal.Api.Data;

public class Employee
{
    public int Id { get; set; }
    /// <summary>Used in the export file name: OT_[YYMM]_[NAME EN]</summary>
    public required string NameEn { get; set; }
    public required string NameTh { get; set; }
    public int DefaultBreakMinutes { get; set; }
}

public class OtEntry
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public DateOnly Date { get; set; }
    public TimeOnly Start { get; set; }
    public TimeOnly End { get; set; }
    public int BreakMinutes { get; set; }
    public bool Support { get; set; }
    public string? Project { get; set; }
    public string? Remark { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Holiday
{
    public DateOnly Date { get; set; }
    public required string Name { get; set; }
}

/// <summary>A place the employee named (from Google Timeline), matched again next time by place id or by distance.</summary>
public class SavedPlace
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public string? PlaceId { get; set; }
    public double Lat { get; set; }
    public double Lng { get; set; }
    public string? Name { get; set; }
    public string? Project { get; set; }
    public string? Address { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<OtEntry> Entries => Set<OtEntry>();
    public DbSet<Holiday> Holidays => Set<Holiday>();
    public DbSet<SavedPlace> Places => Set<SavedPlace>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Employee>().HasIndex(e => e.NameEn).IsUnique();
        b.Entity<OtEntry>().HasIndex(e => new { e.EmployeeId, e.Date });
        b.Entity<OtEntry>().HasOne<Employee>().WithMany().HasForeignKey(e => e.EmployeeId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Holiday>().HasKey(h => h.Date);
        b.Entity<SavedPlace>().HasIndex(p => p.EmployeeId);
        b.Entity<SavedPlace>().HasOne<Employee>().WithMany().HasForeignKey(p => p.EmployeeId).OnDelete(DeleteBehavior.Cascade);
    }
}
