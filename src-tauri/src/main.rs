// Release builds on Windows are GUI apps: without this, Windows opens a black console window next to Alfie.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() { alfie_lib::run() }
