namespace OtPortal.Api.Domain;

public enum DayType { Weekday, Weekend, Holiday }

/// <summary>Morning = 00:00-08:30, Day = 08:30-18:00, Evening = 18:00-24:00</summary>
public enum TimeWindow { Morning, Day, Evening }

public sealed record OtSegment(
    DateOnly Date,
    DayType DayType,
    TimeWindow Window,
    int StartMinute,   // minutes from midnight of Date
    int EndMinute,     // exclusive, up to 1440
    int BreakMinutes,
    decimal Rate)      // 0 = not OT (normal working hours)
{
    public int GrossMinutes => EndMinute - StartMinute;
    public int NetMinutes => GrossMinutes - BreakMinutes;
    public decimal WeightedMinutes => NetMinutes * Rate;
    public bool IsPaid => Rate > 0 && NetMinutes > 0;
}

public sealed record OtResult(IReadOnlyList<OtSegment> Segments, IReadOnlyList<string> Warnings)
{
    public IEnumerable<OtSegment> Paid => Segments.Where(s => s.IsPaid);
    public bool HasOt => Paid.Any();
}

/// <summary>
/// OT rules ported from legacy KC_OT.exe (Export OT Version 4.3).
/// The legacy app rejected any entry that crossed 08:30 / 18:00 / midnight;
/// here an entry is split at those boundaries and each part is rated on its own.
/// </summary>
public static class OtCalculator
{
    public const int DayStart = 8 * 60 + 30;  // 08:30
    public const int DayEnd = 18 * 60;        // 18:00
    private const int MinutesPerDay = 24 * 60;

    public static decimal RateFor(DayType dayType, TimeWindow window, bool support) => (dayType, window) switch
    {
        (DayType.Weekday, TimeWindow.Day) => 0m,              // normal working hours
        (DayType.Weekday, _) => 1.5m,
        (DayType.Weekend, TimeWindow.Day) => support ? 1.5m : 1.0m,
        (DayType.Holiday, TimeWindow.Day) => 1.0m,            // legacy: Holiday overrides Support
        _ => 3.0m,                                            // weekend/holiday outside 08:30-18:00
    };

    public static DayType GetDayType(DateOnly date, Func<DateOnly, bool> isHoliday) =>
        isHoliday(date) ? DayType.Holiday
        : date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday ? DayType.Weekend
        : DayType.Weekday;

    /// <param name="end">End time; if not after <paramref name="start"/> it is taken as the next day.</param>
    /// <param name="breakMinutes">Deducted from the 08:30-18:00 paid part first (lunch), then other paid parts in time order.</param>
    public static OtResult Calculate(DateOnly date, TimeOnly start, TimeOnly end, int breakMinutes, bool support,
        Func<DateOnly, bool> isHoliday)
    {
        if (breakMinutes < 0) throw new ArgumentOutOfRangeException(nameof(breakMinutes));

        var startMin = start.Hour * 60 + start.Minute;
        var endMin = end.Hour * 60 + end.Minute;
        if (endMin <= startMin) endMin += MinutesPerDay;

        var segments = new List<OtSegment>();
        var cursor = startMin;
        while (cursor < endMin)
        {
            var dayOffset = cursor / MinutesPerDay;
            var local = cursor % MinutesPerDay;
            var window = local < DayStart ? TimeWindow.Morning : local < DayEnd ? TimeWindow.Day : TimeWindow.Evening;
            var windowEnd = window switch { TimeWindow.Morning => DayStart, TimeWindow.Day => DayEnd, _ => MinutesPerDay };
            var localEnd = Math.Min(windowEnd, endMin - dayOffset * MinutesPerDay);

            var segDate = date.AddDays(dayOffset);
            var dayType = GetDayType(segDate, isHoliday);
            segments.Add(new OtSegment(segDate, dayType, window, local, localEnd, 0, RateFor(dayType, window, support)));
            cursor = dayOffset * MinutesPerDay + localEnd;
        }

        var warnings = new List<string>();
        var remaining = AllocateBreak(segments, breakMinutes);
        if (remaining > 0)
            warnings.Add($"เวลาพัก {remaining} นาที เกินเวลา OT ที่มี จึงไม่ได้หักส่วนนี้");
        if (segments.Any(s => s.Rate == 0))
            warnings.Add("ช่วง 08:30-18:00 ของวันทำงานปกติ ไม่นับเป็น OT");

        return new OtResult(segments, warnings);
    }

    private static int AllocateBreak(List<OtSegment> segments, int breakMinutes)
    {
        var order = segments
            .Select((s, i) => (s, i))
            .Where(x => x.s.Rate > 0)
            .OrderBy(x => x.s.Window == TimeWindow.Day ? 0 : 1)
            .ThenBy(x => x.i)
            .Select(x => x.i)
            .ToList();

        foreach (var i in order)
        {
            if (breakMinutes == 0) break;
            var take = Math.Min(breakMinutes, segments[i].GrossMinutes);
            segments[i] = segments[i] with { BreakMinutes = take };
            breakMinutes -= take;
        }
        return breakMinutes;
    }
}
