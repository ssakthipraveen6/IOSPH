'use strict';

/**
 * analytics/sentinelql/parser.js
 *
 * Recursive descent parser constructing an AST from SentinelQL tokens.
 */

const { TokenType } = require('./lexer');
const {
  ALLOWED_DATASETS,
  ALLOWED_COLUMNS,
  ALLOWED_OPERATORS,
  ALLOWED_AGG_FUNCTIONS,
  MAX_ROW_LIMIT,
  DEFAULT_ROW_LIMIT,
  MAX_TIME_RANGE_SECONDS
} = require('./constants');

// Duration in seconds.
function durationToSeconds(amount, unit) {
  const u = (unit || '').toLowerCase();
  switch (u) {
    case 's': return amount;
    case 'm': return amount * 60;
    case 'h': return amount * 3600;
    case 'd': return amount * 86400;
    default: throw new Error(`Unknown duration unit: ${unit}`);
  }
}

// Parses tokens into a SentinelQL query tree.
class Parser {
  // Creates the parser.
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  current() {
    return this.tokens[this.pos] || { type: TokenType.EOF, value: '' };
  }

  peek() {
    return this.tokens[this.pos + 1] || { type: TokenType.EOF, value: '' };
  }

  // Consumes the next token, checking its type.
  consume(expectedType, expectedValue) {
    const tok = this.current();
    if (expectedType && tok.type !== expectedType) {
      throw new Error(`SentinelQL: expected token type ${expectedType} but found ${tok.type} ('${tok.value}') at position ${tok.pos}`);
    }
    if (expectedValue && tok.value.toLowerCase() !== expectedValue.toLowerCase()) {
      throw new Error(`SentinelQL: expected '${expectedValue}' but found '${tok.value}' at position ${tok.pos}`);
    }
    this.pos++;
    return tok;
  }

  // True when the next token matches.
  match(type, val) {
    const tok = this.current();
    if (tok.type !== type) return false;
    if (val !== undefined && tok.value.toLowerCase() !== val.toLowerCase()) return false;
    return true;
  }

  // Parses a full query.
  parse() {
    // 1. Dataset (e.g. metrics, logs, spans)
    const datasetTok = this.consume(TokenType.IDENT);
    const dataset = datasetTok.value.toLowerCase();
    if (!ALLOWED_DATASETS.has(dataset)) {
      throw new Error(`SentinelQL: unknown or forbidden dataset '${dataset}'. Allowed datasets: ${Array.from(ALLOWED_DATASETS).join(', ')}`);
    }

    const ast = {
      dataset,
      filters: [],
      aggregation: null,
      by: [],
      every: null,
      since: null,
      limit: DEFAULT_ROW_LIMIT
    };

    // 2. Optional WHERE clause
    if (this.match(TokenType.IDENT, 'where')) {
      this.consume(TokenType.IDENT, 'where');
      this.parseWhereClause(ast);
    }

    // Optional 'since' or 'limit' before pipe
    this.parseTimeAndLimit(ast);

    // 3. Optional Pipe (|) Aggregation clause
    if (this.match(TokenType.PIPE)) {
      this.consume(TokenType.PIPE);
      this.parsePipeClause(ast);
    }

    // Optional 'since' or 'limit' after pipe
    this.parseTimeAndLimit(ast);

    // Ensure we reached EOF
    if (this.current().type !== TokenType.EOF) {
      const remaining = this.current();
      throw new Error(`SentinelQL: unexpected token '${remaining.value}' at position ${remaining.pos}`);
    }

    // Default time range if none specified (default: 1 hour)
    if (!ast.since) {
      ast.since = { amount: 1, unit: 'h', raw: '1h', seconds: 3600 };
    }

    return ast;
  }

  // Parses the where clause (allowed columns only).
  parseWhereClause(ast) {
    const allowedCols = ALLOWED_COLUMNS[ast.dataset];
    let logicalOp = 'AND';

    while (this.pos < this.tokens.length) {
      // Check if we hit pipe or keyword like 'since', 'limit'
      if (this.match(TokenType.PIPE) || this.match(TokenType.IDENT, 'since') || this.match(TokenType.IDENT, 'limit')) {
        break;
      }

      // Field
      const fieldTok = this.consume(TokenType.IDENT);
      const field = fieldTok.value.toLowerCase();
      if (!allowedCols[field]) {
        throw new Error(`SentinelQL: invalid or forbidden column '${field}' for dataset '${ast.dataset}'. Allowed columns: ${Object.keys(allowedCols).join(', ')}`);
      }

      // Operator
      const opTok = this.consume(TokenType.OPERATOR);
      const op = opTok.value.toUpperCase();
      if (!ALLOWED_OPERATORS.has(op)) {
        throw new Error(`SentinelQL: unsupported operator '${op}'. Allowed operators: ${Array.from(ALLOWED_OPERATORS).join(', ')}`);
      }

      // Value (String, Number, or Parenthesized list for IN)
      let val;
      if (op === 'IN') {
        this.consume(TokenType.LPAREN);
        val = [];
        while (!this.match(TokenType.RPAREN) && !this.match(TokenType.EOF)) {
          const item = this.current();
          if (item.type === TokenType.STRING || item.type === TokenType.NUMBER) {
            val.push(item.value);
            this.pos++;
          } else {
            throw new Error(`SentinelQL: IN list expects literals, found ${item.type} at position ${item.pos}`);
          }
          if (this.match(TokenType.COMMA)) {
            this.consume(TokenType.COMMA);
          }
        }
        this.consume(TokenType.RPAREN);
      } else {
        const valTok = this.current();
        if (valTok.type === TokenType.STRING || valTok.type === TokenType.NUMBER) {
          val = valTok.value;
          this.pos++;
        } else {
          throw new Error(`SentinelQL: expected literal value for condition '${field} ${op}', found '${valTok.value}' at position ${valTok.pos}`);
        }
      }

      ast.filters.push({
        field: allowedCols[field], // resolved internal column
        rawField: field,
        op,
        value: val,
        logical: logicalOp
      });

      // Check for 'and' or 'or'
      if (this.match(TokenType.IDENT, 'and')) {
        this.consume(TokenType.IDENT, 'and');
        logicalOp = 'AND';
      } else if (this.match(TokenType.IDENT, 'or')) {
        this.consume(TokenType.IDENT, 'or');
        logicalOp = 'OR';
      } else {
        break;
      }
    }
  }

  // Parses time range and limit.
  parseTimeAndLimit(ast) {
    let changed = true;
    while (changed) {
      changed = false;
      if (this.match(TokenType.IDENT, 'since')) {
        this.consume(TokenType.IDENT, 'since');
        const durTok = this.consume(TokenType.DURATION);
        const seconds = durationToSeconds(durTok.amount, durTok.unit);
        if (seconds > MAX_TIME_RANGE_SECONDS) {
          throw new Error(`SentinelQL: time window '${durTok.value}' exceeds maximum allowed retention of 400 days`);
        }
        ast.since = { amount: durTok.amount, unit: durTok.unit, raw: durTok.value, seconds };
        changed = true;
      }

      if (this.match(TokenType.IDENT, 'limit')) {
        this.consume(TokenType.IDENT, 'limit');
        const numTok = this.consume(TokenType.NUMBER);
        const lim = parseInt(numTok.value, 10);
        if (isNaN(lim) || lim < 1) {
          throw new Error(`SentinelQL: limit must be a positive integer, found ${numTok.value}`);
        }
        ast.limit = Math.min(lim, MAX_ROW_LIMIT);
        changed = true;
      }
    }
  }

  // Parses a pipe function (count, avg, ...).
  parsePipeClause(ast) {
    const fnTok = this.consume(TokenType.IDENT);
    const rawFn = fnTok.value.toLowerCase();

    let fn = rawFn;
    let arg = null;
    let targetField = null;

    if (!ALLOWED_AGG_FUNCTIONS.has(fn)) {
      throw new Error(`SentinelQL: unsupported aggregation function '${fn}'. Allowed functions: ${Array.from(ALLOWED_AGG_FUNCTIONS).join(', ')}`);
    }

    this.consume(TokenType.LPAREN);
    // Arguments inside paren: e.g. count(), avg(value), percentile(95), percentile(95, duration_ms)
    if (!this.match(TokenType.RPAREN)) {
      const firstArg = this.current();
      this.pos++;
      if (firstArg.type === TokenType.NUMBER) {
        arg = firstArg.value;
      } else if (firstArg.type === TokenType.IDENT) {
        targetField = firstArg.value.toLowerCase();
      }

      if (this.match(TokenType.COMMA)) {
        this.consume(TokenType.COMMA);
        const secArg = this.current();
        this.pos++;
        if (secArg.type === TokenType.IDENT) {
          targetField = secArg.value.toLowerCase();
        } else if (secArg.type === TokenType.NUMBER) {
          arg = secArg.value;
        }
      }
    }
    this.consume(TokenType.RPAREN);

    const allowedCols = ALLOWED_COLUMNS[ast.dataset];
    if (targetField && !allowedCols[targetField]) {
      throw new Error(`SentinelQL: invalid aggregation target column '${targetField}'`);
    }

    ast.aggregation = {
      fn,
      arg,
      field: targetField ? allowedCols[targetField] : (ast.dataset === 'metrics' ? 'value' : (ast.dataset === 'spans' ? 'duration_ms' : '*'))
    };

    // By grouping clause: by step / by step, metric
    if (this.match(TokenType.IDENT, 'by')) {
      this.consume(TokenType.IDENT, 'by');
      while (true) {
        const byTok = this.consume(TokenType.IDENT);
        const col = byTok.value.toLowerCase();
        if (!allowedCols[col]) {
          throw new Error(`SentinelQL: invalid group by column '${col}'`);
        }
        ast.by.push({ col: allowedCols[col], alias: col });
        if (this.match(TokenType.COMMA)) {
          this.consume(TokenType.COMMA);
        } else {
          break;
        }
      }
    }

    // Every bucket: every 5m / every 1h
    if (this.match(TokenType.IDENT, 'every')) {
      this.consume(TokenType.IDENT, 'every');
      const durTok = this.consume(TokenType.DURATION);
      const seconds = durationToSeconds(durTok.amount, durTok.unit);
      ast.every = { amount: durTok.amount, unit: durTok.unit, raw: durTok.value, seconds };
    }

    // Optional since/limit after pipe
    this.parseTimeAndLimit(ast);
  }
}

// Parses tokens.
function parse(tokens) {
  const parser = new Parser(tokens);
  return parser.parse();
}

module.exports = {
  Parser,
  parse,
  durationToSeconds
};
