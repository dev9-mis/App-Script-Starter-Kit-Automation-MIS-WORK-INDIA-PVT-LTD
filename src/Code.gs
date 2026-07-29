/**
 * Google Apps Script Starter Kit
 * -------------------------------
 * This project works for BOTH kinds of Apps Script projects:
 *
 *   1. Web apps  — keep doGet() and Index.html. Apps Script calls doGet()
 *      when someone opens the deployed web app URL, which renders
 *      Index.html as the page.
 *   2. Plain automation scripts (no UI) — e.g. sheet-bound scripts, time
 *      triggers, custom menu items. If that's all you need, delete
 *      Index.html and the doGet()/include() functions below, and just
 *      write your own functions. Everything else (clasp login, push,
 *      pull, deploy) works exactly the same either way.
 *
 * Files in this Apps Script project:
 *   Code.gs        (this file)   - server-side entry point and backend logic
 *   Index.html                   - the web app UI (web app projects only)
 *   appsscript.json               - project manifest (timezone, web app access, runtime)
 *
 * Deploy (web app projects):
 *   Apps Script editor -> Deploy -> New deployment -> type "Web app"
 *   -> Execute as "Me" -> Who has access "Anyone" -> Deploy.
 *
 * See README.md in the repo root for the full clone -> install -> login ->
 * push/pull -> deploy workflow using clasp.
 */

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('App Script Starter Kit')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Lets Index.html pull in other HTML files with:
 *   <?!= include('SomeFile') ?>
 * Add more partial .html files as your project grows and include them the
 * same way.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Example server-side function callable from the client via
 * google.script.run.sayHello(name) — see Index.html for the client-side call.
 */
function sayHello(name) {
  return 'Hello, ' + (name || 'world') + '! This came from Code.gs.';
}

/**
 * Example of reading/writing the active Google Sheet, since most Apps
 * Script web apps use a bound Spreadsheet as their "database". Bind this
 * script to a Sheet (Extensions > Apps Script) to use SpreadsheetApp calls.
 */
function getActiveSheetName() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss ? ss.getName() : 'No spreadsheet bound to this script yet.';
}
