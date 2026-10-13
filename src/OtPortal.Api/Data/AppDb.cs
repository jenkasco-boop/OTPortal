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
    public string? Remark { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Holiday
{
    public DateOnly Date { get; set; }
    public required string Name { get; set; }
}

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<OtEntry> Entries => Set<OtEntry>();
    public DbSet<Holiday> Holidays => Set<Holiday>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Employee>().HasIndex(e => e.NameEn).IsUnique();
        b.Entity<OtEntry>().HasIndex(e => new { e.EmployeeId, e.Date });
        b.Entity<OtEntry>().HasOne<Employee>().WithMany().HasForeignKey(e => e.EmployeeId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Holiday>().HasKey(h => h.Date);
    }
}
