use anyhow::{Context, Result};
use keyring::Entry;

const SERVICE: &str = "JARVIS AI";

/// Store an API key in Windows Credential Manager. Never written to disk.
pub fn set_api_key(provider: &str, key: &str) -> Result<()> {
    let entry = Entry::new(SERVICE, provider).context("create credential entry")?;
    entry.set_password(key).context("store credential")?;
    Ok(())
}

pub fn get_api_key(provider: &str) -> Result<Option<String>> {
    let entry = Entry::new(SERVICE, provider).context("create credential entry")?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e).context("read credential"),
    }
}

pub fn delete_api_key(provider: &str) -> Result<()> {
    let entry = Entry::new(SERVICE, provider).context("create credential entry")?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e).context("delete credential"),
    }
}
