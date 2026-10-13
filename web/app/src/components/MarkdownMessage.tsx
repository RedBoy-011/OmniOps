import React, { useState } from "react";

interface MarkdownMessageProps {
  content: string;
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  if (!content) return null;

  // Split content by code blocks: ```lang ... ```
  const parts: React.ReactNode[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const textBefore = content.slice(lastIndex, match.index);
    if (textBefore) {
      parts.push(renderTextBlock(textBefore, `text-${lastIndex}`));
    }

    const language = match[1]?.trim() || "code";
    const code = match[2];
    parts.push(
      <CodeBlock key={`code-${match.index}`} language={language} code={code} />
    );
    lastIndex = match.index + match[0].length;
  }

  const remainingText = content.slice(lastIndex);
  if (remainingText) {
    parts.push(renderTextBlock(remainingText, `text-${lastIndex}`));
  }

  return <div className="markdown-message-container">{parts}</div>;
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="chat-code-block-wrapper" dir="ltr">
      <div className="chat-code-header">
        <span className="chat-code-lang">{language.toUpperCase()}</span>
        <button
          type="button"
          className={`chat-code-copy-btn ${copied ? "copied" : ""}`}
          onClick={handleCopy}
          title="کپی در کلیپ‌بورد"
        >
          {copied ? "✓ کپی شد" : "📋 کپی کد"}
        </button>
      </div>
      <pre className="chat-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderTextBlock(text: string, keyPrefix: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const key = `${keyPrefix}-l-${i}`;

    // Headings
    if (line.startsWith("### ")) {
      elements.push(<h4 key={key} className="chat-md-h3">{renderInline(line.slice(4))}</h4>);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={key} className="chat-md-h2">{renderInline(line.slice(3))}</h3>);
    } else if (line.startsWith("# ")) {
      elements.push(<h2 key={key} className="chat-md-h1">{renderInline(line.slice(2))}</h2>);
    }
    // Blockquote
    else if (line.startsWith("> ")) {
      elements.push(
        <blockquote key={key} className="chat-md-quote">
          {renderInline(line.slice(2))}
        </blockquote>
      );
    }
    // Horizontal rule
    else if (/^(\*\*\*|---|___)$/.test(line.trim())) {
      elements.push(<hr key={key} className="chat-md-hr" />);
    }
    // Bullet list
    else if (/^[-*•]\s+/.test(line.trim())) {
      const itemContent = line.trim().replace(/^[-*•]\s+/, "");
      elements.push(
        <li key={key} className="chat-md-bullet">
          <span className="bullet-dot">•</span>
          <span>{renderInline(itemContent)}</span>
        </li>
      );
    }
    // Numbered list
    else if (/^\d+\.\s+/.test(line.trim())) {
      const match = line.trim().match(/^(\d+)\.\s+(.*)/);
      if (match) {
        elements.push(
          <li key={key} className="chat-md-numbered">
            <span className="numbered-badge">{match[1]}.</span>
            <span>{renderInline(match[2])}</span>
          </li>
        );
      }
    }
    // Normal paragraph line
    else if (line.trim().length > 0) {
      elements.push(
        <p key={key} className="chat-md-p">
          {renderInline(line)}
        </p>
      );
    }
  }

  return <div key={keyPrefix} className="chat-md-text-block">{elements}</div>;
}

function renderInline(text: string): React.ReactNode[] {
  // Regex matches `inline code` or **bold**
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code key={`code-${match.index}`} className="chat-md-inline-code">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <strong key={`bold-${match.index}`} className="chat-md-bold">
          {token.slice(2, -2)}
        </strong>
      );
    }
    lastIdx = match.index + token.length;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return parts;
}
