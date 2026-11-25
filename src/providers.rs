use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

pub trait AiProvider: Send + Sync {
    fn name(&self) -> &str;
    fn chat(&self, system: &str, user: &str) -> Result<String>;
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ProviderKind {
    Nvidia { model: String, base_url: String },
    Gemini { model: String },
    OpenAiCompatible { model: String, base_url: String },
}

pub struct NvidiaProvider {
    pub api_key: String,
    pub model: String,
    pub base_url: String,
}

impl AiProvider for NvidiaProvider {
    fn name(&self) -> &str {
        "nvidia"
    }
    fn chat(&self, system: &str, user: &str) -> Result<String> {
        #[derive(Serialize)]
        struct Msg {
            role: &'static str,
            content: String,
        }
        #[derive(Serialize)]
        struct Req {
            model: String,
            messages: Vec<Msg>,
            temperature: f32,
        }
        #[derive(Deserialize)]
        struct Choice {
            message: ChoiceMsg,
        }
        #[derive(Deserialize)]
        struct ChoiceMsg {
            content: String,
        }
        #[derive(Deserialize)]
        struct Resp {
            choices: Vec<Choice>,
        }

        let client = reqwest::blocking::Client::new();
        let url = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));
        let body = Req {
            model: self.model.clone(),
            messages: vec![
                Msg {
                    role: "system",
                    content: system.to_string(),
                },
                Msg {
                    role: "user",
                    content: user.to_string(),
                },
            ],
            temperature: 0.7,
        };
        let resp = client
            .post(url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .context("nvidia request")?
            .error_for_status()
            .context("nvidia status")?;
        let parsed: Resp = resp.json().context("nvidia json")?;
        Ok(parsed
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .unwrap_or_default())
    }
}

pub struct GeminiProvider {
    pub api_key: String,
    pub model: String,
}

impl AiProvider for GeminiProvider {
    fn name(&self) -> &str {
        "gemini"
    }
    fn chat(&self, system: &str, user: &str) -> Result<String> {
        #[derive(Serialize)]
        struct Part {
            text: String,
        }
        #[derive(Serialize)]
        struct Content {
            parts: Vec<Part>,
        }
        #[derive(Serialize)]
        struct Sys {
            parts: Vec<Part>,
        }
        #[derive(Serialize)]
        struct Req {
            contents: Vec<Content>,
            system_instruction: Sys,
        }
        #[derive(Deserialize)]
        struct Candidate {
            content: CandContent,
        }
        #[derive(Deserialize)]
        struct CandContent {
            parts: Vec<PartOut>,
        }
        #[derive(Deserialize)]
        struct PartOut {
            text: Option<String>,
        }
        #[derive(Deserialize)]
        struct Resp {
            candidates: Option<Vec<Candidate>>,
        }

        let client = reqwest::blocking::Client::new();
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            self.model, self.api_key
        );
        let body = Req {
            contents: vec![Content {
                parts: vec![Part {
                    text: user.to_string(),
                }],
            }],
            system_instruction: Sys {
                parts: vec![Part {
                    text: system.to_string(),
                }],
            },
        };
        let resp = client
            .post(url)
            .json(&body)
            .send()
            .context("gemini request")?
            .error_for_status()
            .context("gemini status")?;
        let parsed: Resp = resp.json().context("gemini json")?;
        Ok(parsed
            .candidates
            .and_then(|c| c.into_iter().next())
            .map(|c| {
                c.content
                    .parts
                    .into_iter()
                    .filter_map(|p| p.text)
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default())
    }
}
