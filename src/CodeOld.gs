// ═══ LEGACY REFERENCE — NOT LOADED BY THE LIVE APP ═══
// Pre-dates the current MASTER/RESPONSES sheet split (Code.gs). Written against
// an older single-sheet "DATA ENTRY" / "RESPONSES" / "RESPONSES 2" layout.
// Kept here as a reference example for the multi sheet-format "page format"
// support planned for this project — not wired into doGet() or any include().
// Still pushed to the Apps Script project (full src/ sync), but inert there
// since nothing calls it.
//
// /**
//  * Version             : v1.10
//  * Updated At          : 09-Jul-2026
//  * Version Notes       :
//  *   - Enhanced save_data() to process RESPONSES and RESPONSES 2 independently.
//  *   - Added validation for both Column B and Column K.
//  *   - Supports saving to either sheet or both sheets based on available data.
//  *   - Prevents save operation only when both columns are blank for all rows.
//  */

// function save_data() {
//   const ws = SpreadsheetApp.getActiveSpreadsheet();
//   // const pageformat = ws.getSheetByName("Copy of DATA ENTRY");
//   const pageformat = ws.getSheetByName("DATA ENTRY");
//   const responses = ws.getSheetByName("RESPONSES");
//   const responses2 = ws.getSheetByName("RESPONSES 2");

//   const formatActiveRange = pageformat.getActiveRange();
//   const row = formatActiveRange.getRow();
//   const column = formatActiveRange.getColumn();
//   const trigger = pageformat.getRange(row, column).getValue();
//   const check = pageformat.getRange("N3").getValue();


//   if (row == 2 && column == 14 && trigger == "YES" && check == "OK") {
//     const msgRange = pageformat.getRange("O2");
//     msgRange.setValue("Script started.");

//     let rawData = pageformat.getRange("A1:O128").getValues();

//     const dataRows = rawData.slice(5);

//     // Rows for RESPONSES (Column B)
//     const itemsRows = dataRows.filter(r => String(r[1]).trim() !== "");
//     // Rows for RESPONSES 2 (Column K)
//     const itemsRows2 = dataRows.filter(r => String(r[10]).trim() !== "");

//     // If neither B nor K contains data
//     if (itemsRows.length === 0 && itemsRows2.length === 0) {
//       msgRange.setValue("Warning: No valid rows found.");
//       return;
//     }

//     let todayDate = new Date();
//     let dateValue = rawData[2][4];


//     if (itemsRows.length > 0) {
//       const saveRows = itemsRows.map(r => [
//         todayDate,
//         dateValue,
//         r[1],
//         r[2],
//         r[3],
//         r[4],
//         r[5],
//         r[6],
//         r[7]
//       ]);

//       const lastRow = responses.getRange("A1:A").getValues().reduce((acc, row, i) => row[0] !== "" ? i + 1 : acc, 0) + 1;
//       responses.getRange(lastRow, 1, saveRows.length, saveRows[0].length).setValues(saveRows);
//     }

//     if (itemsRows2.length > 0) {
//       const saveRows2 = itemsRows2.map(r => [
//         todayDate,
//         dateValue,
//         r[9],
//         r[10]
//       ]);

//       const lastRow2 = responses2.getRange("A1:A").getValues().reduce((acc, row, i) => row[0] !== "" ? i + 1 : acc, 0) + 1;
//       responses2.getRange(lastRow2, 1, saveRows2.length, saveRows2[0].length).setValues(saveRows2);
//     }

//     msgRange.setValue("Data saved successfully.");


//     const lastRow = pageformat.getLastRow();

//     pageformat.getRangeList([
//       "E3",
//       `B6:B${lastRow}`,
//       `G6:H${lastRow}`,
//       `J6:K${lastRow}`,
//       "N2"
//     ]).clearContent();

//   }
// }
