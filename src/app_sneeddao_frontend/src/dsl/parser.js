// SneedScript DSL Parser — Tokenizer + Recursive Descent Parser
// Parses DSL text into an AST of statements (ensure, remove, set, submit).

// ============================================
// TOKEN TYPES
// ============================================

const TT = {
  KEYWORD: 'KEYWORD',
  IDENT: 'IDENT',
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  LBRACE: 'LBRACE',
  RBRACE: 'RBRACE',
  LBRACKET: 'LBRACKET',
  RBRACKET: 'RBRACKET',
  COLON: 'COLON',
  COMMA: 'COMMA',
  SLASH: 'SLASH',
  LT: 'LT',
  GT: 'GT',
  EOF: 'EOF',
};

const KEYWORDS = new Set([
  'ensure', 'remove', 'set', 'submit', 'reset_stats',
  'token', 'chore', 'action', 'move_action', 'rebalance_target',
  'rebalance', 'distribution', 'circuit_breaker', 'circuit_breaker_enabled',
  'dex', 'purse', 'event_subscription', 'event_reaction', 'event_emission',
  'logging', 'chore_logging', 'trade',
  'price_staleness', 'metadata_staleness', 'price_history_max_size',
  'default_slippage', 'default_max_price_impact',
  'in', 'from', 'to',
  'true', 'false', 'none', 'auto',
  'when', 'then', 'ALL', 'ANY',
  'price', 'balance', 'value',
  'stop', 'pause', 'start', 'freeze', 'unfreeze',
  'all', 'chores',
  'changed', 'up', 'down', 'either',
  'in_range', 'outside_range',
  'denominated_in', 'main', '__main__',
  'type', 'label', 'enabled',
  'range', 'percent',
  'stop_loss', 'take_profit', 'on_exec', 'never',
  'bps', 's', 'm', 'h',
  'ICPSwap', 'KongSwap',
  'account', 'share',
  'fund_purse', 'reclaim', 'send', 'withdraw',
  'status', 'running', 'paused', 'stopped',
  'interval', 'max_interval', 'task_timeout',
  'equals', 'not_equals', 'contains', 'greater_than', 'less_than',
]);

// ============================================
// TOKENIZER
// ============================================

export class TokenizerError extends Error {
  constructor(message, line, col) {
    super(`Line ${line}:${col}: ${message}`);
    this.line = line;
    this.col = col;
  }
}

export function tokenize(input) {
  const tokens = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  function peek() { return pos < input.length ? input[pos] : null; }
  function advance() {
    const ch = input[pos++];
    if (ch === '\n') { line++; col = 1; } else { col++; }
    return ch;
  }
  function skipWhitespace() {
    while (pos < input.length && (input[pos] === ' ' || input[pos] === '\t' || input[pos] === '\r')) {
      advance();
    }
  }
  function skipComment() {
    if (peek() === '#') {
      while (pos < input.length && input[pos] !== '\n') advance();
    }
  }

  function readString() {
    const startLine = line, startCol = col;
    advance(); // opening quote
    let value = '';
    while (pos < input.length && input[pos] !== '"') {
      if (input[pos] === '\\') {
        advance();
        const escaped = advance();
        if (escaped === 'n') value += '\n';
        else if (escaped === 't') value += '\t';
        else if (escaped === '\\') value += '\\';
        else if (escaped === '"') value += '"';
        else value += escaped;
      } else {
        value += advance();
      }
    }
    if (pos >= input.length) throw new TokenizerError('Unterminated string', startLine, startCol);
    advance(); // closing quote
    return { type: TT.STRING, value, line: startLine, col: startCol };
  }

  function readNumber() {
    const startLine = line, startCol = col;
    let numStr = '';
    let hasDecimal = false;
    if (peek() === '-') numStr += advance();
    while (pos < input.length && (isDigit(input[pos]) || input[pos] === '_' || input[pos] === '.')) {
      if (input[pos] === '_') { advance(); continue; }
      if (input[pos] === '.') {
        if (hasDecimal) break;
        hasDecimal = true;
      }
      numStr += advance();
    }
    return { type: TT.NUMBER, value: numStr, line: startLine, col: startCol };
  }

  function readIdentOrKeyword() {
    const startLine = line, startCol = col;
    let value = '';
    while (pos < input.length && isIdentChar(input[pos])) {
      value += advance();
    }
    const type = KEYWORDS.has(value) ? TT.KEYWORD : TT.IDENT;
    return { type, value, line: startLine, col: startCol };
  }

  function isDigit(ch) { return ch >= '0' && ch <= '9'; }
  function isIdentStart(ch) { return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'; }
  function isIdentChar(ch) { return isIdentStart(ch) || isDigit(ch) || ch === '-'; }

  while (pos < input.length) {
    skipWhitespace();
    skipComment();
    if (pos >= input.length) break;

    const ch = peek();
    const startLine = line, startCol = col;

    if (ch === '\n') { advance(); continue; }
    if (ch === '#') { skipComment(); continue; }
    if (ch === '"') { tokens.push(readString()); continue; }
    if (ch === '{') { advance(); tokens.push({ type: TT.LBRACE, value: '{', line: startLine, col: startCol }); continue; }
    if (ch === '}') { advance(); tokens.push({ type: TT.RBRACE, value: '}', line: startLine, col: startCol }); continue; }
    if (ch === '[') { advance(); tokens.push({ type: TT.LBRACKET, value: '[', line: startLine, col: startCol }); continue; }
    if (ch === ']') { advance(); tokens.push({ type: TT.RBRACKET, value: ']', line: startLine, col: startCol }); continue; }
    if (ch === ':') { advance(); tokens.push({ type: TT.COLON, value: ':', line: startLine, col: startCol }); continue; }
    if (ch === ',') { advance(); tokens.push({ type: TT.COMMA, value: ',', line: startLine, col: startCol }); continue; }
    if (ch === '/') { advance(); tokens.push({ type: TT.SLASH, value: '/', line: startLine, col: startCol }); continue; }
    if (ch === '<') { advance(); tokens.push({ type: TT.LT, value: '<', line: startLine, col: startCol }); continue; }
    if (ch === '>') { advance(); tokens.push({ type: TT.GT, value: '>', line: startLine, col: startCol }); continue; }

    if (isDigit(ch) || (ch === '-' && pos + 1 < input.length && isDigit(input[pos + 1]))) {
      tokens.push(readNumber());
      continue;
    }

    if (isIdentStart(ch)) {
      tokens.push(readIdentOrKeyword());
      continue;
    }

    throw new TokenizerError(`Unexpected character: ${ch}`, startLine, startCol);
  }

  tokens.push({ type: TT.EOF, value: '', line, col });
  return tokens;
}

// ============================================
// PARSER
// ============================================

export class ParseError extends Error {
  constructor(message, token) {
    super(`Line ${token?.line || '?'}:${token?.col || '?'}: ${message}`);
    this.token = token;
    this.line = token?.line;
    this.col = token?.col;
  }
}

export function parse(tokens) {
  let pos = 0;

  function current() { return tokens[pos]; }
  function peek() { return tokens[pos]; }
  function advance() { return tokens[pos++]; }
  function expect(type, value) {
    const tok = current();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      throw new ParseError(`Expected ${value || type} but got '${tok.value}'`, tok);
    }
    return advance();
  }
  function match(type, value) {
    const tok = current();
    if (tok.type === type && (value === undefined || tok.value === value)) {
      return advance();
    }
    return null;
  }
  function isAt(type, value) {
    const tok = current();
    return tok.type === type && (value === undefined || tok.value === value);
  }

  function parseProgram() {
    const statements = [];
    while (!isAt(TT.EOF)) {
      statements.push(parseStatement());
    }
    return { type: 'program', statements };
  }

  function parseStatement() {
    const tok = current();
    if (tok.type === TT.KEYWORD) {
      switch (tok.value) {
        case 'ensure': return parseEnsure();
        case 'remove': return parseRemove();
        case 'set': return parseSet();
        case 'submit': return parseSubmit();
        case 'reset_stats': return parseResetStats();
        default:
          throw new ParseError(`Unexpected keyword: ${tok.value}`, tok);
      }
    }
    throw new ParseError(`Expected statement (ensure/remove/set/submit), got '${tok.value}'`, tok);
  }

  // ---- ensure ----
  function parseEnsure() {
    const startTok = expect(TT.KEYWORD, 'ensure');
    const entityType = parseEntityType();

    switch (entityType) {
      case 'token': return parseEnsureToken(startTok);
      case 'chore': return parseEnsureChore(startTok);
      case 'action': return parseEnsureAction(startTok);
      case 'rebalance_target': return parseEnsureRebalanceTarget(startTok);
      case 'distribution': return parseEnsureDistribution(startTok);
      case 'circuit_breaker': return parseEnsureCircuitBreaker(startTok);
      case 'event_subscription': return parseEnsureEventSubscription(startTok);
      case 'event_reaction': return parseEnsureEventReaction(startTok);
      default:
        throw new ParseError(`Cannot 'ensure' entity type: ${entityType}`, startTok);
    }
  }

  function parseEntityType() {
    const tok = advance();
    if (tok.type === TT.KEYWORD || tok.type === TT.IDENT) return tok.value;
    throw new ParseError(`Expected entity type, got '${tok.value}'`, tok);
  }

  function parseKey() {
    const tok = current();
    if (tok.type === TT.STRING) return advance().value;
    if (tok.type === TT.IDENT || tok.type === TT.KEYWORD) return advance().value;
    throw new ParseError(`Expected key (string or identifier), got '${tok.value}'`, tok);
  }

  function parseBlock() {
    expect(TT.LBRACE);
    const properties = {};
    while (!isAt(TT.RBRACE) && !isAt(TT.EOF)) {
      const key = parsePropertyKey();
      expect(TT.COLON);
      const value = parseValue();
      properties[key] = value;
      match(TT.COMMA); // optional comma separator
    }
    expect(TT.RBRACE);
    return properties;
  }

  function parsePropertyKey() {
    const tok = current();
    if (tok.type === TT.IDENT || tok.type === TT.KEYWORD) return advance().value;
    if (tok.type === TT.STRING) return advance().value;
    throw new ParseError(`Expected property key, got '${tok.value}'`, tok);
  }

  function parseValue() {
    const tok = current();

    // Boolean
    if (tok.type === TT.KEYWORD && tok.value === 'true') { advance(); return { type: 'bool', value: true }; }
    if (tok.type === TT.KEYWORD && tok.value === 'false') { advance(); return { type: 'bool', value: false }; }

    // None
    if (tok.type === TT.KEYWORD && tok.value === 'none') { advance(); return { type: 'none' }; }

    // Auto
    if (tok.type === TT.KEYWORD && tok.value === 'auto') { advance(); return { type: 'auto' }; }

    // Special keywords used as enum values
    if (tok.type === TT.KEYWORD && ['range', 'percent', 'stop_loss', 'take_profit', 'on_exec', 'never',
      'running', 'paused', 'stopped', 'ICPSwap', 'KongSwap', 'trade', 'rebalance',
      'fund_purse', 'reclaim', 'send', 'move-funds', 'distribute-funds', 'snapshot',
      'equals', 'not_equals', 'contains', 'greater_than', 'less_than',
      'main', '__main__'].includes(tok.value)) {
      advance();
      return { type: 'keyword', value: tok.value };
    }

    // List
    if (tok.type === TT.LBRACKET) return parseList();

    // Number (possibly with unit)
    if (tok.type === TT.NUMBER) return parseNumberWithUnit();

    // String
    if (tok.type === TT.STRING) { advance(); return { type: 'string', value: tok.value }; }

    // Inline object { ... }
    if (tok.type === TT.LBRACE) return parseInlineObject();

    // Identifier (token symbol or other reference)
    if (tok.type === TT.IDENT || tok.type === TT.KEYWORD) {
      advance();
      return { type: 'ident', value: tok.value };
    }

    throw new ParseError(`Expected value, got '${tok.value}'`, tok);
  }

  function parseNumberWithUnit() {
    const numTok = advance();
    const num = numTok.value;
    const tok = current();

    // Check for unit suffix
    if (tok.type === TT.KEYWORD || tok.type === TT.IDENT) {
      if (tok.value === 'bps') { advance(); return { type: 'bps', value: num }; }
      if (tok.value === 's') { advance(); return { type: 'duration', value: num, unit: 's' }; }
      if (tok.value === 'm') { advance(); return { type: 'duration', value: num, unit: 'm' }; }
      if (tok.value === 'h') { advance(); return { type: 'duration', value: num, unit: 'h' }; }
      // Token amount (number followed by token symbol)
      if (tok.type === TT.IDENT || (tok.type === TT.KEYWORD && !['bps', 's', 'm', 'h', 'in', 'from', 'to', 'true', 'false', 'none'].includes(tok.value))) {
        const symbol = advance().value;
        return { type: 'amount', value: num, token: symbol };
      }
    }

    return { type: 'number', value: num };
  }

  function parseList() {
    expect(TT.LBRACKET);
    const items = [];
    while (!isAt(TT.RBRACKET) && !isAt(TT.EOF)) {
      items.push(parseValue());
      match(TT.COMMA);
    }
    expect(TT.RBRACKET);
    return { type: 'list', items };
  }

  function parseInlineObject() {
    expect(TT.LBRACE);
    const props = {};
    while (!isAt(TT.RBRACE) && !isAt(TT.EOF)) {
      const key = parsePropertyKey();
      expect(TT.COLON);
      const value = parseValue();
      props[key] = value;
      match(TT.COMMA);
    }
    expect(TT.RBRACE);
    return { type: 'object', properties: props };
  }

  // ---- ensure token ----
  function parseEnsureToken(startTok) {
    const key = parseKey();
    const properties = parseBlock();
    return { type: 'ensure', entity: 'token', key, properties, line: startTok.line };
  }

  // ---- ensure chore ----
  function parseEnsureChore(startTok) {
    const key = parseKey();
    const properties = parseBlock();
    return { type: 'ensure', entity: 'chore', key, properties, line: startTok.line };
  }

  // ---- ensure action ----
  function parseEnsureAction(startTok) {
    const key = parseKey();
    let scope = null;
    if (match(TT.KEYWORD, 'in')) {
      scope = parseKey();
    }
    const properties = parseBlock();
    return { type: 'ensure', entity: 'action', key, scope, properties, line: startTok.line };
  }

  // ---- ensure rebalance_target ----
  function parseEnsureRebalanceTarget(startTok) {
    const key = parseKey();
    let scope = null;
    if (match(TT.KEYWORD, 'in')) {
      scope = parseKey();
    }
    const properties = parseBlock();
    return { type: 'ensure', entity: 'rebalance_target', key, scope, properties, line: startTok.line };
  }

  // ---- ensure distribution ----
  function parseEnsureDistribution(startTok) {
    const key = parseKey();
    let scope = null;
    if (match(TT.KEYWORD, 'in')) {
      scope = parseKey();
    }
    const properties = parseBlock();
    return { type: 'ensure', entity: 'distribution', key, scope, properties, line: startTok.line };
  }

  // ---- ensure circuit_breaker ----
  function parseEnsureCircuitBreaker(startTok) {
    const key = parseKey();
    expect(TT.LBRACE);
    const properties = {};
    let conditions = null;
    let actions = null;

    while (!isAt(TT.RBRACE) && !isAt(TT.EOF)) {
      if (isAt(TT.KEYWORD, 'enabled')) {
        advance();
        expect(TT.COLON);
        properties.enabled = parseValue();
      } else if (isAt(TT.KEYWORD, 'when')) {
        advance();
        conditions = parseCBConditionBlock();
      } else if (isAt(TT.KEYWORD, 'then')) {
        advance();
        actions = parseCBActionBlock();
      } else {
        const key2 = parsePropertyKey();
        expect(TT.COLON);
        properties[key2] = parseValue();
      }
      match(TT.COMMA);
    }
    expect(TT.RBRACE);

    return {
      type: 'ensure', entity: 'circuit_breaker', key, properties,
      conditions, actions, line: startTok.line,
    };
  }

  function parseCBConditionBlock() {
    const operator = current().value; // ALL or ANY
    advance();
    expect(TT.LBRACE);
    const conditions = [];
    while (!isAt(TT.RBRACE) && !isAt(TT.EOF)) {
      conditions.push(parseCBCondition());
      match(TT.COMMA);
    }
    expect(TT.RBRACE);
    return { operator, conditions };
  }

  function parseCBCondition() {
    const tok = current();

    // Nested ALL/ANY
    if ((tok.type === TT.KEYWORD && (tok.value === 'ALL' || tok.value === 'ANY'))) {
      return parseCBConditionBlock();
    }

    // price TOKEN1/TOKEN2 <op> <value>  OR  price TOKEN1/TOKEN2 changed <dir> <bps> in <duration>
    if (tok.type === TT.KEYWORD && tok.value === 'price') {
      advance();
      const token1 = parseKey();
      expect(TT.SLASH);
      const token2 = parseKey();

      if (isAt(TT.KEYWORD, 'changed')) {
        advance();
        const direction = advance().value; // up/down/either
        const changeBps = parseValue();
        expect(TT.KEYWORD, 'in');
        const period = parseValue();
        return { type: 'price_change', token1, token2, direction, changeBps, period };
      }

      const op = parseComparisonOp();
      const threshold = parseValue();
      return { type: 'price', token1, token2, op, threshold };
    }

    // balance TOKEN in <purse> <op> <value>
    if (tok.type === TT.KEYWORD && tok.value === 'balance') {
      advance();
      const token = parseKey();
      expect(TT.KEYWORD, 'in');
      const purse = parseKey();
      const op = parseComparisonOp();
      const threshold = parseValue();
      return { type: 'balance', token, purse, op, threshold };
    }

    // value <sources> denominated_in TOKEN <op> <value>
    if (tok.type === TT.KEYWORD && tok.value === 'value') {
      advance();
      const sources = parseValueSources();
      expect(TT.KEYWORD, 'denominated_in');
      const denomToken = parseKey();
      const op = parseComparisonOp();
      const threshold = parseValue();
      return { type: 'value', sources, denomToken, op, threshold };
    }

    throw new ParseError(`Expected condition (price/balance/value/ALL/ANY), got '${tok.value}'`, tok);
  }

  function parseComparisonOp() {
    const tok = current();
    if (tok.type === TT.GT) { advance(); return '>'; }
    if (tok.type === TT.LT) { advance(); return '<'; }
    if (tok.type === TT.KEYWORD && tok.value === 'in_range') { advance(); return 'in_range'; }
    if (tok.type === TT.KEYWORD && tok.value === 'outside_range') { advance(); return 'outside_range'; }
    throw new ParseError(`Expected comparison operator (>, <, in_range, outside_range), got '${tok.value}'`, tok);
  }

  function parseValueSources() {
    const sources = [];
    // ALL in <purse>, TOKEN in <purse>, or comma-separated
    if (isAt(TT.KEYWORD, 'ALL') || isAt(TT.KEYWORD, 'all')) {
      advance();
      expect(TT.KEYWORD, 'in');
      const purse = parseKey();
      sources.push({ type: 'all', purse });
    } else {
      const token = parseKey();
      expect(TT.KEYWORD, 'in');
      const purse = parseKey();
      sources.push({ type: 'token', token, purse });
    }
    return sources;
  }

  function parseCBActionBlock() {
    expect(TT.LBRACE);
    const actions = [];
    while (!isAt(TT.RBRACE) && !isAt(TT.EOF)) {
      actions.push(parseCBAction());
      match(TT.COMMA);
    }
    expect(TT.RBRACE);
    return actions;
  }

  function parseCBAction() {
    const tok = current();

    // stop/pause/start chore "id"
    // stop/pause/start all [TYPE] chores
    // freeze/unfreeze token TOKEN
    // pause token TOKEN [in "rebal-id"]
    if (tok.type === TT.KEYWORD && ['stop', 'pause', 'start', 'freeze', 'unfreeze'].includes(tok.value)) {
      const verb = advance().value;

      if (isAt(TT.KEYWORD, 'all') || isAt(TT.KEYWORD, 'ALL')) {
        advance();
        if (isAt(TT.KEYWORD, 'chores')) {
          advance();
          return { type: `${verb}_all_chores` };
        }
        const choreType = parseKey();
        expect(TT.KEYWORD, 'chores');
        return { type: `${verb}_all_chores_by_type`, choreType };
      }

      if (isAt(TT.KEYWORD, 'chore')) {
        advance();
        const choreId = parseKey();
        return { type: `${verb}_chore`, choreId };
      }

      if (isAt(TT.KEYWORD, 'token')) {
        advance();
        const token = parseKey();
        if (verb === 'pause' && match(TT.KEYWORD, 'in')) {
          const rebalId = parseKey();
          return { type: 'pause_token_in_rebal', token, rebalId };
        }
        return { type: `${verb}_token`, token };
      }

      throw new ParseError(`Expected 'chore', 'all', or 'token' after '${verb}'`, current());
    }

    throw new ParseError(`Expected circuit breaker action (stop/pause/start/freeze), got '${tok.value}'`, tok);
  }

  // ---- ensure event_subscription ----
  function parseEnsureEventSubscription(startTok) {
    expect(TT.KEYWORD, 'to');
    const key = parseKey(); // source bot principal
    const properties = parseBlock();
    return { type: 'ensure', entity: 'event_subscription', key, properties, line: startTok.line };
  }

  // ---- ensure event_reaction ----
  function parseEnsureEventReaction(startTok) {
    const key = parseKey();
    const properties = parseBlock();
    return { type: 'ensure', entity: 'event_reaction', key, properties, line: startTok.line };
  }

  // ---- remove ----
  function parseRemove() {
    const startTok = expect(TT.KEYWORD, 'remove');
    const entityType = parseEntityType();
    let key, scope = null;

    switch (entityType) {
      case 'token':
        key = parseKey();
        return { type: 'remove', entity: 'token', key, line: startTok.line };

      case 'chore':
        key = parseKey();
        return { type: 'remove', entity: 'chore', key, line: startTok.line };

      case 'action':
        key = parseKey();
        if (match(TT.KEYWORD, 'from')) scope = parseKey();
        return { type: 'remove', entity: 'action', key, scope, line: startTok.line };

      case 'rebalance_target':
        key = parseKey();
        if (match(TT.KEYWORD, 'from')) scope = parseKey();
        return { type: 'remove', entity: 'rebalance_target', key, scope, line: startTok.line };

      case 'distribution':
        key = parseKey();
        if (match(TT.KEYWORD, 'from')) scope = parseKey();
        return { type: 'remove', entity: 'distribution', key, scope, line: startTok.line };

      case 'circuit_breaker':
        key = parseKey();
        return { type: 'remove', entity: 'circuit_breaker', key, line: startTok.line };

      case 'event_subscription':
        expect(TT.KEYWORD, 'to');
        key = parseKey();
        return { type: 'remove', entity: 'event_subscription', key, line: startTok.line };

      case 'event_reaction':
        key = parseKey();
        return { type: 'remove', entity: 'event_reaction', key, line: startTok.line };

      case 'chore_logging':
        key = parseKey();
        return { type: 'remove', entity: 'chore_logging', key, line: startTok.line };

      default:
        throw new ParseError(`Cannot 'remove' entity type: ${entityType}`, startTok);
    }
  }

  // ---- set ----
  function parseSet() {
    const startTok = expect(TT.KEYWORD, 'set');
    const tok = current();

    // Dispatch based on entity/target keyword
    if (tok.type === TT.KEYWORD || tok.type === TT.IDENT) {
      const target = tok.value;

      // set token TOKEN property: value
      if (target === 'token') {
        advance();
        const tokenKey = parseKey();
        const property = parsePropertyKey();
        expect(TT.COLON);
        const value = parseValue();
        return { type: 'set', entity: 'token', key: tokenKey, property, value, line: startTok.line };
      }

      // set chore "id" property: value
      if (target === 'chore') {
        advance();
        const choreKey = parseKey();
        const property = parsePropertyKey();
        expect(TT.COLON);
        const value = parseValue();
        return { type: 'set', entity: 'chore', key: choreKey, property, value, line: startTok.line };
      }

      // set dex NAME property: value
      if (target === 'dex') {
        advance();
        const dexName = parseKey();
        const property = parsePropertyKey();
        expect(TT.COLON);
        const value = parseValue();
        return { type: 'set', entity: 'dex', key: dexName, property, value, line: startTok.line };
      }

      // set rebalance "id" property: value
      if (target === 'rebalance') {
        advance();
        const rebalKey = parseKey();
        const property = parsePropertyKey();
        expect(TT.COLON);
        const value = parseValue();
        return { type: 'set', entity: 'rebalance', key: rebalKey, property, value, line: startTok.line };
      }

      // set purse "id" property: value
      if (target === 'purse') {
        advance();
        const purseKey = parseKey();
        const property = parsePropertyKey();
        expect(TT.COLON);
        const value = parseValue();
        return { type: 'set', entity: 'purse', key: purseKey, property, value, line: startTok.line };
      }

      // set trade "id" property: value (for fallback_route_tokens)
      if (target === 'trade') {
        advance();
        const tradeKey = parseKey();
        const property = parsePropertyKey();
        expect(TT.COLON);
        const value = parseValue();
        return { type: 'set', entity: 'trade', key: tradeKey, property, value, line: startTok.line };
      }

      // set logging property: value
      if (target === 'logging') {
        advance();
        const property = parsePropertyKey();
        expect(TT.COLON);
        const value = parseValue();
        return { type: 'set', entity: 'logging', property, value, line: startTok.line };
      }

      // set chore_logging "id" property: value
      if (target === 'chore_logging') {
        advance();
        const choreKey = parseKey();
        const property = parsePropertyKey();
        expect(TT.COLON);
        const value = parseValue();
        return { type: 'set', entity: 'chore_logging', key: choreKey, property, value, line: startTok.line };
      }

      // Global scalar settings: set <name>: value
      if (['circuit_breaker_enabled', 'event_emission',
        'default_slippage', 'default_max_price_impact',
        'price_staleness', 'metadata_staleness', 'price_history_max_size'].includes(target)) {
        advance();
        expect(TT.COLON);
        const value = parseValue();
        return { type: 'set', entity: 'global', property: target, value, line: startTok.line };
      }
    }

    throw new ParseError(`Unexpected set target: ${tok.value}`, tok);
  }

  // ---- submit ----
  function parseSubmit() {
    const startTok = expect(TT.KEYWORD, 'submit');
    const actionType = parseKey();

    switch (actionType) {
      case 'trade':
      case 'withdraw':
      case 'send':
      case 'fund_purse':
      case 'reclaim': {
        const properties = parseBlock();
        return { type: 'submit', action: actionType, properties, line: startTok.line };
      }
      default:
        throw new ParseError(`Unknown submit action: ${actionType}`, startTok);
    }
  }

  // ---- reset_stats ----
  function parseResetStats() {
    const startTok = expect(TT.KEYWORD, 'reset_stats');
    const entityType = parseEntityType();
    if (entityType !== 'action') {
      throw new ParseError(`reset_stats only works on 'action', got '${entityType}'`, startTok);
    }
    const key = parseKey();
    let scope = null;
    if (match(TT.KEYWORD, 'in')) scope = parseKey();
    return { type: 'reset_stats', entity: 'action', key, scope, line: startTok.line };
  }

  return parseProgram();
}

// ============================================
// PUBLIC API
// ============================================

export function parseDSL(input) {
  const tokens = tokenize(input);
  return parse(tokens);
}
