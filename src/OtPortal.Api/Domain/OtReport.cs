using OtPortal.Api.Data;

namespace OtPortal.Api.Domain;

/// <summary>One line of the monthly report. Same columns as the legacy KC_OT grid.</summary>
public sealed record OtLine(
    int No,
    int EntryId,
    string Name,
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

public sealed record OtTotals(decimal Ot10, decimal Ot15, decimal Ot30, decimal OtxTime);

public sealed record OtMonthReport(string FileName, Employee Employee, int Year, int Month,
    IReadOnlyList<OtLine> Lines, OtTotals Totals);

public static class OtReport
{
    public static string FileName(Employee e, int year, int month) =>
        $"OT_{year % 100:00}{month:00}_{SanitizeName(e.NameEn)}";

    private static string SanitizeName(string nameEn) =>
        new string(nameEn.Trim().ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());

    public static OtMonthReport Build(Employee employee, int year, int month, IEnumerable<OtEntry> entries,
        Func<DateOnly, bool> isHoliday)
    {
        var lines = new List<OtLine>();
        foreach (var entry in entries.OrderBy(e => e.Date).ThenBy(e => e.Start))
        {
            var result = OtCalculator.Calculate(entry.Date, entry.Start, entry.End, entry.BreakMinutes, entry.Support, isHoliday);
            foreach (var s in result.Paid)
            {
                var special = s.DayType == DayType.Holiday ? "Holiday" : entry.Support ? "Support" : "";
                lines.Add(new OtLine(
                    No: lines.Count + 1,
                    EntryId: entry.Id,
                    Name: employee.NameTh,
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
        return new OtMonthReport(FileName(employee, year, month), employee, year, month, lines, totals);
    }

    private static string Hhmm(int minutes) => minutes >= 1440 ? "24:00" : $"{minutes / 60:00}:{minutes % 60:00}";
}
