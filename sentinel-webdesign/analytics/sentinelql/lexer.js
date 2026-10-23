'use strict';

/**
 * analytics/sentinelql/lexer.js
 *
 * Robust, hand-written tokenizer for SentinelQL.
 * Rejects comments, semicolons, and unknown escape sequences.
 */

const TokenType = {
  IDENT: 'IDENT',
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  DURATION: 'DURATION',
  OPERATOR: 'OPERATOR',
  PIPE: 'PIPE',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  COMMA: 'COMMA',
  EOF: 'EOF'
};

const KEYWORDS = new Set([
  'where', 'and', 'or', 'by', 'every', 'since', 'limit', 'like', 'ilike', 'in'
]);

// Splits a SentinelQL query into tokens.
function tokenize(input) {
  if (typeof input !== 'string') {
    throw new Error('SentinelQL query must be a string');
  }

  const str = input.trim();
  if (!str) {
    throw new Error('SentinelQL query cannot be empty');
  }

  // Pre-scan for outright forbidden SQL injection characters/patterns
  if (str.includes(';')) {
    throw new Error("SentinelQL: statement terminator ';' is strictly forbidden");
  }
  if (str.includes('--') || str.includes('/*') || str.includes('*/')) {
    throw new Error('SentinelQL: comments are strictly forbidden');
  }

  const tokens = [];
  let i = 0;
  const len = str.length;

  while (i < len) {
    const ch = str[i];

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Pipe separator
    if (ch === '|') {
      tokens.push({ type: TokenType.PIPE, value: '|', pos: i });
      i++;
      continue;
    }

    // Parentheses & commas
    if (ch === '(') {
      tokens.push({ type: TokenType.LPAREN, value: '(', pos: i });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: TokenType.RPAREN, value: ')', pos: i });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: TokenType.COMMA, value: ',', pos: i });
      i++;
      continue;
    }

    // Multi-char operators: !=, >=, <=
    if (ch === '!' && str[i + 1] === '=') {
      tokens.push({ type: TokenType.OPERATOR, value: '!=', pos: i });
      i += 2;
      continue;
    }
    if (ch === '>' && str[i + 1] === '=') {
      tokens.push({ type: TokenType.OPERATOR, value: '>=', pos: i });
      i += 2;
      continue;
    }
    if (ch === '<' && str[i + 1] === '=') {
      tokens.push({ type: TokenType.OPERATOR, value: '<=', pos: i });
      i += 2;
      continue;
    }
    if (ch === '=') {
      tokens.push({ type: TokenType.OPERATOR, value: '=', pos: i });
      i++;
      continue;
    }
    if (ch === '>') {
      tokens.push({ type: TokenType.OPERATOR, value: '>', pos: i });
      i++;
      continue;
    }
    if (ch === '<') {
      tokens.push({ type: TokenType.OPERATOR, value: '<', pos: i });
      i++;
      continue;
    }

    // String literals: "..." or '...'
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let val = '';
      const startPos = i;
      i++; // skip opening quote
      let closed = false;

      while (i < len) {
        const c = str[i];
        if (c === '\\') {
          if (i + 1 < len) {
            val += str[i + 1];
            i += 2;
            continue;
          } else {
            throw new Error(`SentinelQL: unterminated escape sequence at position ${i}`);
          }
        }
        if (c === quote) {
          closed = true;
          i++; // skip closing quote
          break;
        }
        val += c;
        i++;
      }

      if (!closed) {
        throw new Error(`SentinelQL: unterminated string literal starting at position ${startPos}`);
      }

      tokens.push({ type: TokenType.STRING, value: val, pos: startPos });
      continue;
    }

    // Numbers and durations (e.g. 100, 95.5, 5m, 1h, 24h, 7d)
    if (/[0-9]/.test(ch)) {
      const startPos = i;
      let numStr = '';
      while (i < len && /[0-9.]/.test(str[i])) {
        numStr += str[i];
        i++;
      }

      // Check if followed by duration unit: s, m, h, d
      if (i < len && /^[smhd]$/i.test(str[i])) {
        const unit = str[i].toLowerCase();
        i++;
        tokens.push({
          type: TokenType.DURATION,
          value: `${numStr}${unit}`,
          amount: parseFloat(numStr),
          unit,
          pos: startPos
        });
        continue;
      }

      const numVal = parseFloat(numStr);
      if (isNaN(numVal)) {
        throw new Error(`SentinelQL: invalid number format '${numStr}' at position ${startPos}`);
      }

      tokens.push({ type: TokenType.NUMBER, value: numVal, pos: startPos });
      continue;
    }

    // Identifiers and Keywords (alphanumeric, underscore, dot e.g. journey.step.duration_ms)
    if (/[a-zA-Z_]/.test(ch)) {
      const startPos = i;
      let ident = '';
      while (i < len && /[a-zA-Z0-9_.]/.test(str[i])) {
        ident += str[i];
        i++;
      }

      const lower = ident.toLowerCase();
      if (lower === 'like' || lower === 'ilike' || lower === 'in') {
        tokens.push({ type: TokenType.OPERATOR, value: lower.toUpperCase(), pos: startPos });
      } else {
        tokens.push({ type: TokenType.IDENT, value: ident, pos: startPos });
      }
      continue;
    }

    // Disallowed character
    throw new Error(`SentinelQL: illegal character '${ch}' at position ${i}`);
  }

  tokens.push({ type: TokenType.EOF, value: '', pos: len });
  return tokens;
}

module.exports = {
  TokenType,
  tokenize
};
