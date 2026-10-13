# Excel template

วางไฟล์ไว้ที่ `src/OtPortal.Api/Templates/ot-template.xlsx` แล้ว push ระบบจะใช้ sheet แรกของไฟล์
ถ้าไม่มีไฟล์ ระบบสร้างตารางแบบเดียวกับโปรแกรมเดิมให้เอง

## Token ส่วนหัว/ท้าย (ใส่ในเซลล์ไหนก็ได้)

| Token | ตัวอย่าง |
|---|---|
| `{{NAME_TH}}` | เจนวิทย์ ... |
| `{{NAME_EN}}` | JENWIT |
| `{{YYMM}}` | 2609 |
| `{{MONTH_TH}}` | กันยายน 2569 |
| `{{MONTH_EN}}` | September 2026 |
| `{{TOTAL_OT10}}` `{{TOTAL_OT15}}` `{{TOTAL_OT30}}` | ผลรวมนาทีแต่ละอัตรา |
| `{{TOTAL_OTX}}` | ผลรวม OTxTime (นาที) |

## Token แถวข้อมูล

ใส่ใน **แถวเดียว** ระบบจะทำซ้ำแถวนี้ตามจำนวนรายการ (ส่วนท้ายตารางจะถูกดันลงไปเอง และรูปแบบเซลล์ เส้นขอบ สี ของแถวนั้นจะถูกใช้กับทุกแถว)

| Token | ความหมาย |
|---|---|
| `{{row.No}}` | ลำดับ |
| `{{row.Name}}` | ชื่อ-นามสกุล (ไทย) |
| `{{row.Special}}` | "", Support, Holiday |
| `{{row.Day}}` | Monday..Sunday |
| `{{row.Date}}` | dd/MM/yyyy |
| `{{row.TimeIn}}` `{{row.TimeOut}}` | HH:mm |
| `{{row.Duration}}` | h:mm |
| `{{row.Hours}}` `{{row.Minutes}}` | ชั่วโมง / นาที (ก่อนหักพัก) |
| `{{row.BreakMinutes}}` | พัก |
| `{{row.NetMinutes}}` | นาทีรวม (หลังหักพัก) |
| `{{row.Ot10}}` `{{row.Ot15}}` `{{row.Ot30}}` | นาทีในอัตรานั้น (อื่น ๆ = 0) |
| `{{row.OtxTime}}` | นาที × อัตรา |
| `{{row.Remark}}` | หมายเหตุ |
| `{{row.Approve}}` | ช่องว่างสำหรับลงชื่อรับทราบ |

เซลล์ที่มี token ตัวเดียวล้วน ๆ จะได้ค่าเป็นตัวเลข (ใช้สูตร Excel ต่อได้) ถ้ามีข้อความปน เช่น `เวลา {{row.TimeIn}}-{{row.TimeOut}}` จะได้เป็นข้อความ
