use serde::Serialize;
use std::{path::PathBuf, sync::atomic::{AtomicBool, Ordering}};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

struct CloseGuard(AtomicBool);
#[derive(Serialize)]
struct Opened { path: String, data: String, revision: String }
#[tauri::command]
async fn open_project(app: AppHandle) -> Result<Option<Opened>, String> { let Some(folder)=app.dialog().file().blocking_pick_folder() else {return Ok(None)};let path:PathBuf=folder.into_path().map_err(|e|e.to_string())?;let (data,revision)=alfie_core::open(&path).map_err(|e|e.to_string())?;Ok(Some(Opened{path:path.display().to_string(),data,revision})) }
#[tauri::command]
async fn create_project(app: AppHandle, data: String, _guard: State<'_, CloseGuard>) -> Result<Option<Opened>,String> {
    let folder=app.dialog().file().blocking_pick_folder(); let Some(folder)=folder else{return Ok(None)};let path=folder.into_path().map_err(|e|e.to_string())?;let (data,revision)=alfie_core::create(&path,&data).map_err(|e|e.to_string())?;Ok(Some(Opened{path:path.display().to_string(),data,revision}))
}

// ---- manuscript library: every manuscript is its own folder in ~/Documents/Alfie ----
// The library folder can be chosen in the preferences; by default it is ~/Documents/Alfie.
fn library_dir(app:&AppHandle, custom:Option<String>)->Result<PathBuf,String>{let dir=match custom.filter(|c|!c.trim().is_empty()){Some(c)=>PathBuf::from(c),None=>app.path().document_dir().or_else(|_|app.path().home_dir()).map_err(|e|e.to_string())?.join("Alfie")};std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;Ok(dir)}
#[tauri::command]
async fn pick_folder(app:AppHandle)->Result<Option<String>,String>{let Some(folder)=app.dialog().file().blocking_pick_folder() else {return Ok(None)};Ok(Some(folder.into_path().map_err(|e|e.to_string())?.display().to_string()))}
#[derive(Serialize)]
struct Entry { path:String, title:String, author:String, chapters:usize, words:usize, updated:String, git:bool }
fn summarize(dir:&std::path::Path)->Option<Entry>{let raw=std::fs::read_to_string(dir.join(".alfie")).ok()?;let v:serde_json::Value=serde_json::from_str(&raw).ok()?;let chapters=v["chapters"].as_array()?;let words=chapters.iter().map(|c|c["text"].as_str().unwrap_or("").split_whitespace().filter(|w|w.chars().any(|ch|ch.is_alphanumeric())).count()).sum();Some(Entry{path:dir.display().to_string(),title:v["title"].as_str().unwrap_or("Untitled").to_string(),author:v["author"].as_str().unwrap_or("").to_string(),chapters:chapters.len(),words,updated:v["updatedAt"].as_str().unwrap_or("").to_string(),git:dir.join(".git").exists()})}
#[tauri::command]
fn list_library(app:AppHandle, extra:Vec<String>, dir:Option<String>)->Result<serde_json::Value,String>{let dir=library_dir(&app,dir)?;let mut seen=std::collections::HashSet::new();let mut out=vec![];if let Ok(rd)=std::fs::read_dir(&dir){for e in rd.flatten(){let p=e.path();if p.is_dir(){if let Some(en)=summarize(&p){seen.insert(en.path.clone());out.push(en);}}}}for x in extra{let p=PathBuf::from(&x);if seen.contains(&x){continue;}if let Some(en)=summarize(&p){seen.insert(x);out.push(en);}}out.sort_by(|a,b|b.updated.cmp(&a.updated));Ok(serde_json::json!({"dir":dir.display().to_string(),"entries":out}))}
#[tauri::command]
fn create_in_library(app:AppHandle, data:String, title:String, dir:Option<String>)->Result<Opened,String>{let dir=library_dir(&app,dir)?;let slug:String={let s:String=title.chars().map(|c|if c.is_alphanumeric()||c==' '||c=='-'{c}else{' '}).collect();let s=s.split_whitespace().collect::<Vec<_>>().join(" ");if s.is_empty(){"Untitled manuscript".into()}else{s.chars().take(60).collect()}};let mut path=dir.join(&slug);let mut n=2;while path.exists(){path=dir.join(format!("{slug} {n}"));n+=1;}let (data,revision)=alfie_core::create(&path,&data).map_err(|e|e.to_string())?;Ok(Opened{path:path.display().to_string(),data,revision})}
#[tauri::command]
fn save_project(path:String,data:String,expected:String)->Result<String,String>{alfie_core::save(PathBuf::from(path).as_path(),&data,&expected).map_err(|e|e.to_string())}
#[tauri::command]
fn reload_project(path:String)->Result<Opened,String>{let path=PathBuf::from(path);let (data,revision)=alfie_core::open(&path).map_err(|e|e.to_string())?;Ok(Opened{path:path.display().to_string(),data,revision})}
#[tauri::command]
fn git_action(path:String,action:String,value:String)->Result<String,String>{alfie_core::git_action(PathBuf::from(path).as_path(),&action,&value).map_err(|e|e.to_string())}
#[tauri::command]
fn fullscreen(window:tauri::WebviewWindow,enabled:bool)->Result<(),String>{window.set_fullscreen(enabled).map_err(|e|e.to_string())}
#[tauri::command]
fn set_close_guard(state:State<'_,CloseGuard>,dirty:bool){state.0.store(dirty,Ordering::Relaxed);}
// Restart after an update. On Linux the launcher re-extracts the freshly downloaded AppImage, so prefer it when present.
#[tauri::command]
fn restart_app(app:AppHandle){if let Ok(launcher)=std::env::var("ALFIE_LAUNCHER"){if std::process::Command::new(&launcher).spawn().is_ok(){app.exit(0);return;}}app.restart();}
#[tauri::command]
async fn check_update(app:AppHandle)->Result<serde_json::Value,String>{use tauri_plugin_updater::UpdaterExt;let updater=app.updater().map_err(|e|e.to_string())?;let update=updater.check().await.map_err(|e|e.to_string())?;Ok(match update {Some(u)=>serde_json::json!({"available":true,"version":u.version,"notes":u.body}),None=>serde_json::json!({"available":false})})}
#[tauri::command]
async fn install_update(app:AppHandle)->Result<(),String>{use tauri_plugin_updater::UpdaterExt;let update=app.updater().map_err(|e|e.to_string())?.check().await.map_err(|e|e.to_string())?;if let Some(update)=update {update.download_and_install(|_,_|{},||{}).await.map_err(|e|e.to_string())?;}Ok(())}
pub fn run(){tauri::Builder::default().plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_opener::init()).plugin(tauri_plugin_updater::Builder::new().build()).plugin(tauri_plugin_process::init()).manage(CloseGuard(AtomicBool::new(false))).invoke_handler(tauri::generate_handler![open_project,create_project,save_project,reload_project,git_action,fullscreen,set_close_guard,check_update,install_update,restart_app,list_library,create_in_library,pick_folder]).run(tauri::generate_context!()).expect("Alfie could not open its window");}
