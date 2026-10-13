using OtPortal.Api.Data;
using OtPortal.Api.Domain;

namespace OtPortal.Tests;

public class OtCalculatorTests
{
    // 2026-10-12 Mon, 2026-10-16 Fri, 2026-10-17 Sat, 2026-10-18 Sun
    private static readonly DateOnly Mon = new(2026, 10, 12);
    private static readonly DateOnly Fri = new(2026, 10, 16);
    private static readonly DateOnly Sat = new(2026, 10, 17);
    private static readonly DateOnly HolidayMon = new(2026, 10, 12);

    private static bool NoHoliday(DateOnly _) => false;
    private static bool IsHolidayMon(DateOnly d) => d == HolidayMon;

    private static OtResult Calc(DateOnly date, string start, string end, int brk = 0, bool support = false, Func<DateOnly, bool>? holiday = null) =>
        OtCalculator.Calculate(date, TimeOnly.Parse(start), TimeOnly.Parse(end), brk, support, holiday ?? NoHoliday);

    private static (decimal Rate, int Net)[] Paid(OtResult r) => r.Paid.Select(s => (s.Rate, s.NetMinutes)).ToArray();

    // ----- cases the legacy app accepted: result must be identical -----

    [Theory]
    [InlineData("18:00", "22:00", 0, 240)]
    [InlineData("18:30", "21:00", 30, 120)]
    [InlineData("06:00", "08:30", 0, 150)]
    public void Weekday_outside_hours_is_1_5(string s, string e, int brk, int net) =>
        Assert.Equal([(1.5m, net)], Paid(Calc(Mon, s, e, brk)));

    [Fact]
    public void Weekend_day_is_1_0() => Assert.Equal([(1.0m, 510)], Paid(Calc(Sat, "08:30", "18:00", 60)));

    [Fact]
    public void Weekend_day_support_is_1_5() => Assert.Equal([(1.5m, 570)], Paid(Calc(Sat, "08:30", "18:00", support: true)));

    [Theory]
    [InlineData("18:00", "23:59", 359)]
    [InlineData("00:00", "08:30", 510)]
    public void Weekend_outside_hours_is_3_0(string s, string e, int net) =>
        Assert.Equal([(3.0m, net)], Paid(Calc(Sat, s, e)));

    [Fact]
    public void Holiday_day_is_1_0_even_with_support() =>
        Assert.Equal([(1.0m, 570)], Paid(Calc(HolidayMon, "08:30", "18:00", support: true, holiday: IsHolidayMon)));

    [Fact]
    public void Holiday_evening_is_3_0() =>
        Assert.Equal([(3.0m, 180)], Paid(Calc(HolidayMon, "19:00", "22:00", holiday: IsHolidayMon)));

    [Fact]
    public void Weekday_working_hours_has_no_ot() => Assert.False(Calc(Mon, "09:00", "17:00").HasOt);

    // ----- new behaviour: spans are split automatically -----

    [Fact]
    public void Weekday_span_over_18_00_counts_only_evening()
    {
        var r = Calc(Mon, "17:00", "21:00");
        Assert.Equal([(1.5m, 180)], Paid(r));
        Assert.Contains(r.Warnings, w => w.Contains("08:30-18:00"));
    }

    [Fact]
    public void Weekend_full_day_split_into_three_rates()
    {
        var r = Calc(Sat, "07:00", "20:00", brk: 60);
        Assert.Equal([(3.0m, 90), (1.0m, 510), (3.0m, 120)], Paid(r));
    }

    [Fact]
    public void Overnight_friday_to_saturday_uses_each_days_rate()
    {
        var r = Calc(Fri, "20:00", "02:00");
        Assert.Equal([(1.5m, 240), (3.0m, 120)], Paid(r));
        Assert.Equal(Sat, r.Paid.Last().Date);
    }

    [Fact]
    public void End_at_midnight_means_24_00() => Assert.Equal([(1.5m, 360)], Paid(Calc(Mon, "18:00", "00:00")));

    [Fact]
    public void Break_goes_to_day_window_first()
    {
        var r = Calc(Sat, "08:30", "22:00", brk: 60);
        Assert.Equal([(1.0m, 510), (3.0m, 240)], Paid(r));
    }

    [Fact]
    public void Break_larger_than_ot_warns()
    {
        var r = Calc(Mon, "18:00", "18:30", brk: 45);
        Assert.False(r.HasOt);
        Assert.Contains(r.Warnings, w => w.Contains("15"));
    }

    // ----- report -----

    [Fact]
    public void File_name_follows_OT_YYMM_NAME()
    {
        var e = new Employee { NameEn = "jenwit", NameTh = "เจนวิทย์" };
        Assert.Equal("OT_2609_JENWIT", OtReport.FileName(e, 2026, 9));
    }

    [Fact]
    public void Report_one_line_per_paid_segment_with_totals()
    {
        var e = new Employee { Id = 1, NameEn = "JENWIT", NameTh = "เจนวิทย์" };
        var entries = new[]
        {
            new OtEntry { Id = 1, EmployeeId = 1, Date = Sat, Start = new(7, 0), End = new(20, 0), BreakMinutes = 60 },
            new OtEntry { Id = 2, EmployeeId = 1, Date = Mon, Start = new(18, 0), End = new(20, 0) },
        };
        var r = OtReport.Build(e, 2026, 10, entries, NoHoliday);

        Assert.Equal(4, r.Lines.Count);
        Assert.Equal(Mon, r.Lines[0].Date);                // sorted by date
        Assert.Equal(new OtTotals(510, 120, 210, 120 * 1.5m + 510 + 210 * 3), r.Totals);
    }
}
