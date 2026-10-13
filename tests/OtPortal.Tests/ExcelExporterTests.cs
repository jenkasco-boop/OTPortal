using ClosedXML.Excel;
using OtPortal.Api.Data;
using OtPortal.Api.Domain;
using OtPortal.Api.Export;

namespace OtPortal.Tests;

public class ExcelExporterTests
{
    private static OtMonthReport SampleReport()
    {
        var e = new Employee { Id = 1, NameEn = "JENWIT", NameTh = "เจนวิทย์" };
        var entries = new[]
        {
            new OtEntry { Id = 1, EmployeeId = 1, Date = new(2026, 10, 17), Start = new(7, 0), End = new(20, 0), BreakMinutes = 60, Remark = "Go-live" },
            new OtEntry { Id = 2, EmployeeId = 1, Date = new(2026, 10, 12), Start = new(18, 0), End = new(20, 0) },
        };
        return OtReport.Build(e, 2026, 10, entries, _ => false);
    }

    private static IXLWorksheet Open(byte[] bytes) => new XLWorkbook(new MemoryStream(bytes)).Worksheet(1);

    [Fact]
    public void Default_sheet_has_legacy_columns_rows_and_totals()
    {
        var ws = Open(new ExcelExporter("missing.xlsx").Export(SampleReport()));

        Assert.Contains("เจนวิทย์", ws.Cell(1, 1).GetString());
        Assert.Contains("ตุลาคม", ws.Cell(1, 1).GetString());
        Assert.Equal("OT 1.5", ws.Cell(3, 14).GetString());

        // 4 lines start at row 4: Mon 1.5, then Sat 3.0 / 1.0 / 3.0
        Assert.Equal("12/10/2026", ws.Cell(4, 5).GetString());
        Assert.Equal(120, ws.Cell(4, 14).GetDouble());
        Assert.Equal(180, ws.Cell(4, 16).GetDouble());
        Assert.Equal("Go-live", ws.Cell(7, 17).GetString());

        Assert.Equal("รวม", ws.Cell(8, 12).GetString());
        Assert.Equal(510, ws.Cell(8, 13).GetDouble());
        Assert.Equal(210, ws.Cell(8, 15).GetDouble());
        Assert.DoesNotContain(ws.CellsUsed(), c => c.GetString().Contains("{{"));
    }

    [Fact]
    public void Custom_template_repeats_token_row_and_keeps_footer_below()
    {
        var path = Path.Combine(Path.GetTempPath(), $"ot-template-{Guid.NewGuid():N}.xlsx");
        using (var wb = new XLWorkbook())
        {
            var ws = wb.AddWorksheet("Sheet1");
            ws.Cell("A1").Value = "ชื่อ: {{NAME_TH}} รหัสเดือน {{YYMM}}";
            ws.Cell("B5").Value = "{{row.Date}}";
            ws.Cell("C5").Value = "{{row.OtxTime}}";
            ws.Cell("D5").Value = "เวลา {{row.TimeIn}}-{{row.TimeOut}}";
            ws.Cell("B6").Value = "ลงชื่อผู้อนุมัติ";
            ws.Cell("C6").Value = "{{TOTAL_OTX}}";
            wb.SaveAs(path);
        }

        try
        {
            var ws = Open(new ExcelExporter(path).Export(SampleReport()));
            Assert.Equal("ชื่อ: เจนวิทย์ รหัสเดือน 2610", ws.Cell("A1").GetString());
            Assert.Equal("12/10/2026", ws.Cell("B5").GetString());
            Assert.Equal("เวลา 18:00-20:00", ws.Cell("D5").GetString());
            Assert.Equal(360, ws.Cell("C8").GetDouble());     // Sat 18:00-20:00 x3
            Assert.Equal("ลงชื่อผู้อนุมัติ", ws.Cell("B9").GetString());
            Assert.Equal(180 + 270 + 510 + 360, ws.Cell("C9").GetDouble());
        }
        finally
        {
            File.Delete(path);
        }
    }
}
