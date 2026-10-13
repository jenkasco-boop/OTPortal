using OtPortal.Api.Data;

namespace OtPortal.Api.Domain;

/// <summary>One line of the monthly report. Same columns as the legacy KC_OT grid.</summary>
public sealed record OtLine(
    int No,
    int EntryId,
    string Name,
    string Project,
    string Special,       // "", "Support", "Holiday"
    string Day,           // Monday..Sunday
    DateOnly Date,
    string TimeIn,
    string TimeOut,
    string Duration,      // h:mm (gross)
    int Hours,
    int Minutes,
    int BreakMinutes,
    int NetMinutes,
    decimal Ot10,
    decimal Ot15,
    decimal Ot30,
    decimal OtxTime,
    string Remark);

/// <summary>One row of the "Request OT" section of the company form: one per entry.</summary>
public sealed record OtRequestLine(int No, int EntryId, string Name, string Project, string Detail, DateOnly Date);

public sealed record OtTotals(decimal Ot10, decimal Ot15, decimal Ot30, decimal OtxTime);

public sealed record OtMonthReport(string FileName, Employee Employee, int Year, int Month,
    IReadOnlyList<OtRequestLine> Requests, IReadOnlyList<OtLine> Lines, OtTotals Totals);

/// <summary>OT is paid per period: period "yyyy-MM" runs from the 21st of the previous month to the 20th of that month.</summary>
public static class OtPeriod
{
    public const int CutoffDay = 20;

    public static (DateOnly From, DateOnly ToExclusive) Range(int year, int month)
    {
        var toExclusive = new DateOnly(year, month, CutoffDay + 1);
        return (toExclusive.AddMonths(-1), toExclusive);
    }
}

public static class OtReport
{
    public static string FileName(Employee e, int year, int month) =>
        $"OT_{year % 100:00}{month:00}_{SanitizeName(e.NameEn)}";

    private static string SanitizeName(string nameEn) =>
        new string(nameEn.Trim().ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());

    public static OtMonthReport Build(Employee employee, int year, int month, IEnumerable<OtEntry> entries,
        Func<DateOnly, bool> isHoliday)
    {
        var requests = new List<OtRequestLine>();
        var lines = new List<OtLine>();
        foreach (var entry in entries.OrderBy(e => e.Date).ThenBy(e => e.Start))
        {
            requests.Add(new OtRequestLine(requests.Count + 1, entry.Id, employee.NameTh, entry.Project ?? "", entry.Remark ?? "", entry.Date));

            var result = OtCalculator.Calculate(entry.Date, entry.Start, entry.End, entry.BreakMinutes, entry.Support, isHoliday);
            foreach (var s in result.Paid)
            {
                var special = s.DayType == DayType.Holiday ? "Holiday" : entry.Support ? "Support" : "";
                lines.Add(new OtLine(
                    No: lines.Count + 1,
                    EntryId: entry.Id,
                    Name: employee.NameTh,
                    Project: entry.Project ?? "",
                    Special: special,
                    Day: s.Date.DayOfWeek.ToString(),
                    Date: s.Date,
                    TimeIn: Hhmm(s.StartMinute),
                    TimeOut: Hhmm(s.EndMinute),
                    Duration: $"{s.GrossMinutes / 60}:{s.GrossMinutes % 60:00}",
                    Hours: s.GrossMinutes / 60,
                    Minutes: s.GrossMinutes % 60,
                    BreakMinutes: s.BreakMinutes,
                    NetMinutes: s.NetMinutes,
                    Ot10: s.Rate == 1.0m ? s.NetMinutes : 0,
                    Ot15: s.Rate == 1.5m ? s.NetMinutes : 0,
                    Ot30: s.Rate == 3.0m ? s.NetMinutes : 0,
                    OtxTime: s.WeightedMinutes,
                    Remark: entry.Remark ?? ""));
            }
        }

        var totals = new OtTotals(lines.Sum(l => l.Ot10), lines.Sum(l => l.Ot15), lines.Sum(l => l.Ot30), lines.Sum(l => l.OtxTime));
        return new OtMonthReport(FileName(employee, year, month), employee, year, month, requests, lines, totals);
    }

    private static string Hhmm(int minutes) => minutes >= 1440 ? "24:00" : $"{minutes / 60:00}:{minutes % 60:00}";
}
