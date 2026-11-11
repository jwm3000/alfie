use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::{Component, Path, PathBuf}, process::{Command, Stdio}, sync::atomic::{AtomicU64, Ordering}, thread, time::{Duration, Instant}};

static NEXT_TMP: AtomicU64 = AtomicU64::new(0);
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid project format: {0}")]
    Format(String),
    #[error("The project changed outside Alfie since it was opened. Reopen it to prevent overwriting someone else's changes.")]
    Conflict,
    #[error("Git is unavailable. Install Git and try again.")]
    GitMissing,
    #[error("Git exceeded its 60-second safety limit.")]
    GitTimeout,
    #[error("Git failed: {0}")]
    Git(String),
}
#[derive(Serialize, Deserialize)]
pub struct Project { pub format: String, #[serde(rename="schemaVersion")] pub schema_version: u32, pub id: String, pub title: String, pub author: String, pub goal: u64, pub chapters: Vec<Chapter>, pub ideas: Vec<Idea>, #[serde(rename="updatedAt")] pub updated_at: String }
#[derive(Serialize, Deserialize)]
pub struct Chapter { pub id: String, pub title: String, #[serde(default)] pub subtitle: String, pub text: String, #[serde(default)] pub notes: String, pub status: String, #[serde(default)] pub head: Option<String>, #[serde(default)] pub versions: Vec<Version> }
#[derive(Serialize, Deserialize)]
pub struct Version { pub id: String, pub parent: Option<String>, pub label: String, pub text: String, #[serde(rename="createdAt")] pub created_at: String }
#[derive(Serialize, Deserialize)]
pub struct Idea { pub id: String, pub title: String, pub text: String, pub category: String, #[serde(rename="chapterId")] pub chapter_id: Option<String> }
pub fn validate(data: &str) -> Result<Project, Error> {
    if data.len() > 30_000_000 { return Err(Error::Format("project exceeds 30 MB".into())); }
    let p: Project = serde_json::from_str(data).map_err(|e| Error::Format(e.to_string()))?;
    if p.format != "alfie" || p.schema_version != 1 || p.id.is_empty() || p.goal == 0 || p.goal > 10_000_000 || p.chapters.is_empty() { return Err(Error::Format("unsupported project, schema, or goal".into())); }
    let mut chapter_ids = std::collections::HashSet::new();
    for c in &p.chapters {
        if c.id.is_empty() || !chapter_ids.insert(&c.id) || !["Draft", "Revising", "Finished"].contains(&c.status.as_str()) { return Err(Error::Format("invalid chapter".into())); }
        let mut version_ids = std::collections::HashSet::new();
        for v in &c.versions { if v.id.is_empty() || !version_ids.insert(&v.id) || v.parent.as_ref().is_some_and(|id| !version_ids.contains(id)) { return Err(Error::Format("version history must be unique and ordered before its children".into())); } }
        if c.head.as_ref().is_some_and(|h| !version_ids.contains(h)) { return Err(Error::Format("invalid active version".into())); }
    }
    for i in &p.ideas { if !["Spark", "Character", "World", "Question"].contains(&i.category.as_str()) || i.chapter_id.as_ref().is_some_and(|id| !chapter_ids.contains(id)) { return Err(Error::Format("invalid brainstorm card".into())); } }
    Ok(p)
}
fn hash(data: &[u8]) -> String { format!("{:x}", Sha256::digest(data)) }
fn atomic(path: &Path, data: &[u8]) -> Result<(), Error> {
    let tmp = path.with_extension(format!("alfie-tmp-{}-{}", std::process::id(), NEXT_TMP.fetch_add(1, Ordering::Relaxed)));
    let result = (|| { let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?; f.write_all(data)?; f.sync_all()?; fs::rename(&tmp, path)?; Ok::<(), std::io::Error>(()) })();
    if result.is_err() { let _ = fs::remove_file(&tmp); }
    result.map_err(Error::Io)
}
fn safe_name(s: &str) -> String { let s: String = s.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect(); let s = s.trim_matches('-'); if s.is_empty() { "chapter".into() } else { s.chars().take(64).collect() } }
fn materialize(dir: &Path, p: &Project) -> Result<(), Error> {
    let folder = dir.join("chapters"); fs::create_dir_all(&folder)?;
    let active: std::collections::HashSet<_> = p.chapters.iter().map(|c| format!("{}-{}.md", safe_name(&c.id), safe_name(&c.title))).collect();
    for c in &p.chapters { let mut text = format!("# {}\n", c.title); if !c.subtitle.is_empty() { text.push_str(&format!("\n*{}*\n",c.subtitle)); } text.push_str(&format!("\n{}\n",c.text)); if !c.notes.is_empty() { text.push_str(&format!("\n<!-- Alfie notes\n{}\n-->\n",c.notes)); } atomic(&folder.join(format!("{}-{}.md",safe_name(&c.id),safe_name(&c.title))),text.as_bytes())?; }
    for entry in fs::read_dir(&folder)? { let entry=entry?; let name=entry.file_name().to_string_lossy().to_string(); if entry.file_type()?.is_file() && name.ends_with(".md") && !active.contains(&name) { fs::remove_file(entry.path())?; } }
    Ok(())
}
pub fn open(dir: &Path) -> Result<(String, String), Error> { let path=dir.join(".alfie"); let data=fs::read_to_string(&path)?; validate(&data)?; Ok((data.clone(),hash(data.as_bytes()))) }
pub fn save(dir: &Path, data: &str, expected: &str) -> Result<String, Error> {
    let p=validate(data)?; fs::create_dir_all(dir)?; let path=dir.join(".alfie");
    if path.exists() { if hash(&fs::read(&path)?) != expected { return Err(Error::Conflict); } } else if !expected.is_empty() { return Err(Error::Conflict); }
    atomic(&path,data.as_bytes())?; if let Err(e)=materialize(dir,&p) { return Err(e); } Ok(hash(data.as_bytes()))
}
pub fn create(dir: &Path,data: &str) -> Result<(String,String), Error> { if dir.join(".alfie").exists() { return Err(Error::Format("this folder already contains an Alfie project".into())); } let revision=save(dir,data,"")?; Ok((data.to_owned(),revision)) }
fn git(dir: &Path,args: &[&str]) -> Result<String,Error> {
    let mut c=Command::new("git");
    // On Windows, don't flash a console window for every Git call.
    #[cfg(windows)] { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); } // CREATE_NO_WINDOW
    c.args(args).current_dir(dir).env("GIT_TERMINAL_PROMPT","0").env("GIT_CEILING_DIRECTORIES",dir.parent().unwrap_or(dir)).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child=match c.spawn(){Ok(x)=>x,Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Err(Error::GitMissing),Err(e)=>return Err(e.into())};
    let deadline=Instant::now()+Duration::from_secs(60); while child.try_wait()?.is_none(){if Instant::now()>deadline{let _=child.kill();let _=child.wait();return Err(Error::GitTimeout)} thread::sleep(Duration::from_millis(50));}
    let output=child.wait_with_output()?;let mut text=String::from_utf8_lossy(&output.stdout).trim().to_owned();let err=String::from_utf8_lossy(&output.stderr).trim().to_owned();if !output.status.success(){return Err(Error::Git(if err.is_empty(){text}else{err}));}if !err.is_empty(){text.push_str("\n");text.push_str(&err);}Ok(text)
}
fn check_dir(dir: &Path)->Result<(),Error>{if !dir.join(".alfie").is_file(){return Err(Error::Format("this folder does not contain a valid .alfie project".into()));}validate(&fs::read_to_string(dir.join(".alfie"))?)?;Ok(())}
pub fn git_action(dir:&Path, action:&str, value:&str)->Result<String,Error>{check_dir(dir)?;
 // Each manuscript is its own repository. Never fall through to a repository further up
 // (for example a library folder that happens to be inside Git): only `<manuscript>/.git` counts.
 let inside:Result<(),()>=if dir.join(".git").exists(){Ok(())}else{Err(())};
 match action {
  "init"=>{if inside.is_ok(){Ok("Git is already initialized.".into())}else{git(dir,&["init","-b","main"])?;let ignore=dir.join(".gitignore");if !ignore.exists(){atomic(&ignore,b".DS_Store\nThumbs.db\n*.tmp\n")?;}Ok("Git initialized. Connect a remote to sync.".into())}},
  "remote"=>{let url=value.trim();if !(url.starts_with("https://")||url.starts_with("ssh://")||url.starts_with("git@")){return Err(Error::Format("use an HTTPS or SSH Git repository URL".into()));}if inside.is_err(){return Err(Error::Format("initialize Git first".into()));}let existing=git(dir,&["remote","get-url","origin"]);if existing.is_ok(){git(dir,&["remote","set-url","origin",url])?;}else{git(dir,&["remote","add","origin",url])?;}Ok("GitHub repository connected. Add your SSH key or credential in Git to authenticate.".into())},
  "status"=>{if inside.is_err(){return Ok("Git is not initialized yet.".into());}git(dir,&["status","--short","--branch"])},
  "commit"=>{if inside.is_err(){return Err(Error::Format("initialize Git first".into()));}git(dir,&["add","--",".alfie","chapters/",".gitignore"])?;let r=git(dir,&["commit","-m",&value.chars().take(200).collect::<String>()]);if r.is_err(){let status=git(dir,&["status","--porcelain"])?;if status.is_empty(){return Ok("Everything is already safely committed.".into());}}r},
  "sync"=>{if inside.is_err(){return Err(Error::Format("initialize Git first".into()));}let remote=git(dir,&["remote","get-url","origin"])?;if remote.trim().is_empty(){return Err(Error::Format("connect a GitHub remote first".into()));}let branch=git(dir,&["branch","--show-current"])?;if branch.trim().is_empty(){return Err(Error::Format("commit your project before syncing".into()));}let status=git(dir,&["status","--porcelain"])?;if !status.is_empty(){return Err(Error::Format("Save a commit before syncing. Uncommitted changes have been left untouched.".into()));}git(dir,&["fetch","origin",&branch])?;let remote_branch=format!("origin/{branch}");if git(dir,&["rev-parse","--verify",&remote_branch]).is_err(){git(dir,&["push","-u","origin",&branch])?;}else{let counts=git(dir,&["rev-list","--left-right","--count",&format!("HEAD...{remote_branch}")])?;let mut n=counts.split_whitespace();let ahead=n.next().unwrap_or("0").parse::<u32>().unwrap_or(0);let behind=n.next().unwrap_or("0").parse::<u32>().unwrap_or(0);if ahead>0&&behind>0{return Err(Error::Format("GitHub and this computer have different edits. Nothing changed; reconcile the histories in Git before syncing again.".into()));}if behind>0{git(dir,&["merge","--ff-only",&remote_branch])?;}if ahead>0||behind>0{git(dir,&["push","origin",&branch])?;}}Ok("Project synchronized with GitHub.".into())},
  _=>Err(Error::Format("unknown Git action".into()))
 }
}
