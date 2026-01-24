use regex::Regex;
use std::collections::HashSet;

pub fn strip_html(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ => {
                if !in_tag {
                    output.push(ch);
                }
            }
        }
    }
    output
        .replace('\u{00a0}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn extract_note_files(content: &str) -> Vec<String> {
    let mut results = Vec::new();
    let re_notes_double = Regex::new(r#"src="notes-file://files/(?:evernote/)?([^"]+)""#).unwrap();
    for caps in re_notes_double.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            results.push(path.as_str().to_string());
        }
    }
    let re_notes_single = Regex::new(r#"src='notes-file://files/(?:evernote/)?([^']+)'"#).unwrap();
    for caps in re_notes_single.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            results.push(path.as_str().to_string());
        }
    }
    let re_plain_double = Regex::new(r#"src="files/(?:evernote/)?([^"]+)""#).unwrap();
    for caps in re_plain_double.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            results.push(path.as_str().to_string());
        }
    }
    let re_plain_single = Regex::new(r#"src='files/(?:evernote/)?([^']+)'"#).unwrap();
    for caps in re_plain_single.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            results.push(path.as_str().to_string());
        }
    }
    let re_asset_double = Regex::new(r#"src="[^"]*asset\.localhost[^"]*files/([^"]+)""#).unwrap();
    for caps in re_asset_double.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            results.push(path.as_str().to_string());
        }
    }
    let re_asset_single = Regex::new(r#"src='[^']*asset\.localhost[^']*files/([^']+)'"#).unwrap();
    for caps in re_asset_single.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            results.push(path.as_str().to_string());
        }
    }
    let re_asset_encoded_double =
        Regex::new(r#"src="[^"]*asset\.localhost[^"]*(?i:files%2F)([^"]+)""#).unwrap();
    for caps in re_asset_encoded_double.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            let candidate = format!("files/{}", path.as_str());
            if let Ok(decoded) = urlencoding::decode(&candidate) {
                results.push(decoded.to_string().trim_start_matches("files/").to_string());
            }
        }
    }
    let re_asset_encoded_single =
        Regex::new(r#"src='[^']*asset\.localhost[^']*(?i:files%2F)([^']+)'"#).unwrap();
    for caps in re_asset_encoded_single.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            let candidate = format!("files/{}", path.as_str());
            if let Ok(decoded) = urlencoding::decode(&candidate) {
                results.push(decoded.to_string().trim_start_matches("files/").to_string());
            }
        }
    }
    results.sort();
    results.dedup();
    results
}

pub const OCR_IMAGE_FILTER: &str = "(
    lower(f.file_path) LIKE '%.png' OR
    lower(f.file_path) LIKE '%.jpg' OR
    lower(f.file_path) LIKE '%.jpeg' OR
    lower(f.file_path) LIKE '%.gif' OR
    lower(f.file_path) LIKE '%.webp' OR
    lower(f.file_path) LIKE '%.bmp' OR
    lower(f.file_path) LIKE '%.jfif' OR
    lower(f.file_path) LIKE '%.tif' OR
    lower(f.file_path) LIKE '%.tiff' OR
    lower(a.mime) LIKE 'image/%'
)";

pub fn extract_attachment_ids(content: &str) -> HashSet<i64> {
    let mut results = HashSet::new();
    let re_double = Regex::new(r#"data-attachment-id="(\d+)""#).unwrap();
    for caps in re_double.captures_iter(content) {
        if let Some(value) = caps.get(1) {
            if let Ok(id) = value.as_str().parse::<i64>() {
                results.insert(id);
            }
        }
    }
    let re_single = Regex::new(r#"data-attachment-id='(\d+)'"#).unwrap();
    for caps in re_single.captures_iter(content) {
        if let Some(value) = caps.get(1) {
            if let Ok(id) = value.as_str().parse::<i64>() {
                results.insert(id);
            }
        }
    }
    results
}
