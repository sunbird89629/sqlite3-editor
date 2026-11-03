use std::sync::Arc;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use rusqlite::functions::FunctionFlags;
use rusqlite::types::ValueRef;

use crate::cli_error::CLIError;

static REGEX_CACHE: Lazy<Arc<Mutex<(String, regex::Regex)>>> = Lazy::new(|| {
    Arc::new(Mutex::<(String, regex::Regex)>::new((
        "".to_owned(),
        regex::Regex::new("").unwrap(),
    )))
});
static LEGACY_REGEX_CACHE: Lazy<Mutex<Option<(String, bool, Option<regex::Regex>)>>> = Lazy::new(|| Mutex::new(None));

pub fn register_sqlite_functions_for_find_widget(con: &rusqlite::Connection) -> std::result::Result<(), CLIError> {
    // Compatibility with the public editor's four-argument search function.
    con.create_scalar_function(
        "find_widget_regexp",
        4,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC | FunctionFlags::SQLITE_INNOCUOUS,
        move |ctx| {
            let pattern = ctx.get::<String>(1)?;
            let whole_word = ctx.get::<i64>(2)? != 0;
            let case_sensitive = ctx.get::<i64>(3)? != 0;
            let pattern = if whole_word { format!(r"\b(?:{pattern})\b") } else { pattern };
            let mut cache = LEGACY_REGEX_CACHE.lock().unwrap();
            if !cache
                .as_ref()
                .is_some_and(|(cached_pattern, cached_case, _)| cached_pattern == &pattern && *cached_case == case_sensitive)
            {
                let regex = regex::RegexBuilder::new(&pattern).case_insensitive(!case_sensitive).build().ok();
                *cache = Some((pattern, case_sensitive, regex));
            }
            let matches = cache
                .as_ref()
                .and_then(|(_, _, regex)| regex.as_ref())
                .is_some_and(|regex| regex.is_match(&get_find_widget_input(ctx)));
            Ok(i64::from(matches))
        },
    )
    .or_else(|err| CLIError::new_ffi_error(err, "sqlite3_create_function_v2", &["find_widget_regexp".into()]))?;
    // Register functions
    con.create_scalar_function(
        "find_widget_compare_w_c",
        2,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC | FunctionFlags::SQLITE_INNOCUOUS,
        move |ctx| Ok(find_widget_compare_w_c(ctx)),
    )
    .or_else(|err| CLIError::new_ffi_error(err, "sqlite3_create_function_v2", &["find_widget_compare_w_c".into()]))?;

    con.create_scalar_function(
        "find_widget_compare_w",
        2,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC | FunctionFlags::SQLITE_INNOCUOUS,
        move |ctx| Ok(find_widget_compare_w(ctx)),
    )
    .or_else(|err| CLIError::new_ffi_error(err, "sqlite3_create_function_v2", &["find_widget_compare_w".into()]))?;

    con.create_scalar_function(
        "find_widget_compare_c",
        2,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC | FunctionFlags::SQLITE_INNOCUOUS,
        move |ctx| Ok(find_widget_compare_c(ctx)),
    )
    .or_else(|err| CLIError::new_ffi_error(err, "sqlite3_create_function_v2", &["find_widget_compare_c".into()]))?;

    con.create_scalar_function(
        "find_widget_compare",
        2,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC | FunctionFlags::SQLITE_INNOCUOUS,
        move |ctx| Ok(find_widget_compare(ctx)),
    )
    .or_else(|err| CLIError::new_ffi_error(err, "sqlite3_create_function_v2", &["find_widget_compare".into()]))?;

    con.create_scalar_function(
        "find_widget_compare_r_w_c",
        2,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC | FunctionFlags::SQLITE_INNOCUOUS,
        move |ctx| Ok(find_widget_compare_r_w_c(ctx)),
    )
    .or_else(|err| CLIError::new_ffi_error(err, "sqlite3_create_function_v2", &["find_widget_compare_r_w_c".into()]))?;

    con.create_scalar_function(
        "find_widget_compare_r_w",
        2,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC | FunctionFlags::SQLITE_INNOCUOUS,
        move |ctx| Ok(find_widget_compare_r_w(ctx)),
    )
    .or_else(|err| CLIError::new_ffi_error(err, "sqlite3_create_function_v2", &["find_widget_compare_r_w".into()]))?;

    con.create_scalar_function(
        "find_widget_compare_r_c",
        2,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC | FunctionFlags::SQLITE_INNOCUOUS,
        move |ctx| Ok(find_widget_compare_r_c(ctx)),
    )
    .or_else(|err| CLIError::new_ffi_error(err, "sqlite3_create_function_v2", &["find_widget_compare_r_c".into()]))?;

    con.create_scalar_function(
        "find_widget_compare_r",
        2,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC | FunctionFlags::SQLITE_INNOCUOUS,
        move |ctx| Ok(find_widget_compare_r(ctx)),
    )
    .or_else(|err| CLIError::new_ffi_error(err, "sqlite3_create_function_v2", &["find_widget_compare_r".into()]))?;

    Ok(())
}

#[inline]
fn get_find_widget_input(ctx: &rusqlite::functions::Context) -> String {
    match ctx.get_raw(0) {
        ValueRef::Null => "NULL".to_owned(),
        ValueRef::Integer(v) => format!("{v}"),
        ValueRef::Real(v) => format!("{v}"),
        ValueRef::Text(v) => String::from_utf8_lossy(v).to_string(),
        ValueRef::Blob(_v) => "".to_owned(), // hex won't match against anything
    }
}

/// whole_word = true, case_sensitive = true, regex = false
fn find_widget_compare_w_c(ctx: &rusqlite::functions::Context) -> i64 {
    ctx.get::<String>(1).is_ok_and(|r| get_find_widget_input(ctx) == r) as i64
}

/// whole_word = true, case_sensitive = false, regex = false
fn find_widget_compare_w(ctx: &rusqlite::functions::Context) -> i64 {
    ctx.get::<String>(1)
        .is_ok_and(|r| get_find_widget_input(ctx).to_lowercase() == r.to_lowercase()) as i64
}

/// whole_word = false, case_sensitive = true, regex = false
fn find_widget_compare_c(ctx: &rusqlite::functions::Context) -> i64 {
    ctx.get::<String>(1).is_ok_and(|r| get_find_widget_input(ctx).contains(&r)) as i64
}

/// whole_word = false, case_sensitive = false, regex = false
fn find_widget_compare(ctx: &rusqlite::functions::Context) -> i64 {
    ctx.get::<String>(1)
        .is_ok_and(|r| get_find_widget_input(ctx).to_lowercase().contains(&r.to_lowercase())) as i64
}

#[inline]
fn regex_match(text: &str, pattern: String) -> bool {
    {
        let regex_cached = REGEX_CACHE.lock().unwrap();
        if regex_cached.0 == pattern {
            return regex_cached.1.is_match(text);
        }
    }

    let Ok(v) = regex::Regex::new(&pattern) else {
        return false;
    };
    let matched = v.is_match(text);
    *REGEX_CACHE.lock().unwrap() = (pattern, v);
    matched
}

// whole_word = true, case_sensitive = true, regex = true
fn find_widget_compare_r_w_c(ctx: &rusqlite::functions::Context) -> i64 {
    ctx.get::<String>(1)
        .is_ok_and(|pattern| !pattern.is_empty() && regex_match(&get_find_widget_input(ctx), format!("(?s)\\b(?:{pattern})\\b"))) as i64
}

/// whole_word = true, case_sensitive = false, regex = true
fn find_widget_compare_r_w(ctx: &rusqlite::functions::Context) -> i64 {
    ctx.get::<String>(1)
        .is_ok_and(|pattern| !pattern.is_empty() && regex_match(&get_find_widget_input(ctx), format!("(?i)(?s)\\b(?:{pattern})\\b")))
        as i64
}

/// whole_word = false, case_sensitive = true, regex = true
fn find_widget_compare_r_c(ctx: &rusqlite::functions::Context) -> i64 {
    ctx.get::<String>(1)
        .is_ok_and(|pattern| regex_match(&get_find_widget_input(ctx), format!("(?s){pattern}"))) as i64
}

/// whole_word = false, case_sensitive = false, regex = true
fn find_widget_compare_r(ctx: &rusqlite::functions::Context) -> i64 {
    ctx.get::<String>(1)
        .is_ok_and(|pattern| regex_match(&get_find_widget_input(ctx), format!("(?i)(?s){pattern}"))) as i64
}
