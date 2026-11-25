//! Looking into a SQLite database file: its tables and views, and the rows of a query.
//!
//! The file is only ever opened read only (the connection itself refuses writes, and a statement that is not read only is turned away before it runs), so
//! looking at a database can never change it. Every value comes back as text for display: NULL as nothing, a number as its digits, a blob by its size.

use rusqlite::{types::ValueRef, Connection, OpenFlags};
use serde::Serialize;
use std::path::Path;
use std::time::Duration;

/// The most rows one answer carries.
const MAX_ROWS: usize = 1000;
/// Longer text is cut for display (the cell shows the start).
const MAX_CELL_CHARS: usize = 2000;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
  pub name: String,
  /// `table` or `view`.
  pub kind: String,
  /// The number of rows; none when counting failed (a view that cannot be evaluated, say).
  pub rows: Option<i64>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
  pub columns: Vec<String>,
  pub rows: Vec<Vec<Option<String>>>,
  /// There are more rows after these.
  pub more: bool,
}

fn open(path: &str) -> Result<Connection, String> {
  if !Path::new(path).is_file() {
    return Err("the file does not exist".to_string());
  }
  let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|error| error.to_string())?;
  connection.busy_timeout(Duration::from_secs(3)).map_err(|error| error.to_string())?;
  connection.pragma_update(None, "query_only", "ON").map_err(|error| error.to_string())?;
  Ok(connection)
}

/// An identifier written for use in a statement: in double quotes, with quotes doubled.
fn quoted(name: &str) -> String {
  format!("\"{}\"", name.replace('"', "\"\""))
}

fn show(value: ValueRef) -> Option<String> {
  match value {
    ValueRef::Null => None,
    ValueRef::Integer(number) => Some(number.to_string()),
    ValueRef::Real(number) => Some(number.to_string()),
    ValueRef::Text(bytes) => {
      let text = String::from_utf8_lossy(bytes);
      Some(if text.chars().count() > MAX_CELL_CHARS { text.chars().take(MAX_CELL_CHARS).collect::<String>() + "…" } else { text.into_owned() })
    }
    ValueRef::Blob(bytes) => Some(format!("<BLOB {} B>", bytes.len())),
  }
}

fn tables(path: &str) -> Result<Vec<TableInfo>, String> {
  let connection = open(path)?;
  let mut statement = connection
    .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .map_err(|error| error.to_string())?;
  let found: Vec<(String, String)> = statement
    .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
    .map_err(|error| error.to_string())?
    .collect::<Result<_, _>>()
    .map_err(|error| error.to_string())?;
  Ok(found
    .into_iter()
    .map(|(name, kind)| {
      let rows = connection.query_row(&format!("SELECT COUNT(*) FROM {}", quoted(&name)), [], |row| row.get::<_, i64>(0)).ok();
      TableInfo { name, kind, rows }
    })
    .collect())
}

fn query(path: &str, sql: &str, offset: usize, limit: usize) -> Result<QueryResult, String> {
  let connection = open(path)?;
  let mut statement = connection.prepare(sql.trim().trim_end_matches(';')).map_err(|error| error.to_string())?;
  if !statement.readonly() {
    return Err("only statements that read (SELECT) are run here".to_string());
  }
  let columns: Vec<String> = statement.column_names().iter().map(|name| name.to_string()).collect();
  let limit = limit.clamp(1, MAX_ROWS);
  let mut rows = statement.query([]).map_err(|error| error.to_string())?;
  let mut skipped = 0;
  let mut out: Vec<Vec<Option<String>>> = Vec::new();
  let mut more = false;
  while let Some(row) = rows.next().map_err(|error| error.to_string())? {
    if skipped < offset { skipped += 1; continue; }
    if out.len() == limit { more = true; break; }
    out.push((0..columns.len()).map(|index| row.get_ref(index).map(show).unwrap_or(None)).collect());
  }
  Ok(QueryResult { columns, rows: out, more })
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
  tauri::async_runtime::spawn_blocking(job).await.map_err(|error| error.to_string())?
}

/// The tables and views of a database file.
#[tauri::command]
pub async fn sqlite_tables(path: String) -> Result<Vec<TableInfo>, String> { blocking(move || tables(&path)).await }

/// The rows of a read only statement: `limit` rows after `offset` (at most 1000).
#[tauri::command]
pub async fn sqlite_query(path: String, sql: String, offset: u32, limit: u32) -> Result<QueryResult, String> { blocking(move || query(&path, &sql, offset as usize, limit as usize)).await }

#[cfg(test)]
mod tests {
  use super::*;

  /// A database in a file of its own, made with an ordinary (writable) connection.
  fn sample() -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("typenova-sqlite-test-{}-{:?}.db", std::process::id(), std::thread::current().id()).replace(['(', ')'], ""));
    let _ = std::fs::remove_file(&path);
    let connection = Connection::open(&path).unwrap();
    connection.execute_batch("CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, score REAL, photo BLOB); INSERT INTO people (name, score, photo) VALUES ('Ann', 1.5, x'0102'), ('Bob', NULL, NULL), ('Cy', 3, NULL); CREATE VIEW names AS SELECT name FROM people;").unwrap();
    path
  }

  #[test]
  fn tables_and_views_are_listed_with_their_rows() {
    let path = sample();
    let found = tables(path.to_str().unwrap()).unwrap();
    assert_eq!(found, vec![TableInfo { name: "people".into(), kind: "table".into(), rows: Some(3) }, TableInfo { name: "names".into(), kind: "view".into(), rows: Some(3) }]);
    let _ = std::fs::remove_file(path);
  }

  #[test]
  fn rows_come_back_as_text_in_pages() {
    let path = sample();
    let file = path.to_str().unwrap();
    let first = query(file, "SELECT id, name, score, photo FROM people ORDER BY id;", 0, 2).unwrap();
    assert_eq!(first.columns, vec!["id", "name", "score", "photo"]);
    assert_eq!(first.rows[0], vec![Some("1".into()), Some("Ann".into()), Some("1.5".into()), Some("<BLOB 2 B>".into())]);
    assert_eq!(first.rows[1][2], None);
    assert!(first.more);
    let rest = query(file, "SELECT name FROM people ORDER BY id", 2, 2).unwrap();
    assert_eq!(rest.rows, vec![vec![Some("Cy".to_string())]]);
    assert!(!rest.more);
    let _ = std::fs::remove_file(path);
  }

  #[test]
  fn nothing_that_writes_is_run() {
    let path = sample();
    let file = path.to_str().unwrap();
    for sql in ["DELETE FROM people", "DROP TABLE people", "INSERT INTO people (name) VALUES ('x')", "CREATE TABLE x (a)"] {
      assert!(query(file, sql, 0, 10).is_err(), "{sql}");
    }
    assert_eq!(tables(file).unwrap()[0].rows, Some(3));
    assert!(query("Z:\\no\\such\\file.db", "SELECT 1", 0, 1).is_err());
    let _ = std::fs::remove_file(path);
  }
}
