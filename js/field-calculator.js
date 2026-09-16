/**
 * GeoCanvas GIS Tool - Safe Field Calculator & Geometry Info Engine
 *
 * Strictly prohibited: arbitrary code execution, dynamic Functions, setTimeout string.
 * Implements a recursive-descent AST parser for mathematical, string,
 * and spatial geometry variable calculations.
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. AST TOKENS & LEXER
  // =========================================================================

  const TokenType = {
    NUMBER: 'NUMBER',
    STRING: 'STRING',
    IDENTIFIER: 'IDENTIFIER',
    GEOM_VAR: 'GEOM_VAR',
    OPERATOR: 'OPERATOR',
    LPAREN: 'LPAREN',
    RPAREN: 'RPAREN',
    COMMA: 'COMMA',
    EOF: 'EOF'
  };

  const BUILTIN_FUNCTIONS = new Set([
    'round', 'abs', 'min', 'max', 'coalesce', 'nvl',
    'trim', 'upper', 'lower', 'substring', 'substr', 'concat'
  ]);

  const GEOMETRY_VARIABLES = new Set([
    '$area_m2', '$area_ha', '$length_m', '$length_km',
    '$perimeter_m', '$x', '$y', '$centroid_x', '$centroid_y',
    '$geom_type', '$vertex_count'
  ]);

  class Lexer {
    constructor(input) {
      this.input = String(input || '');
      this.pos = 0;
      this.length = this.input.length;
    }

    peek() {
      return this.pos < this.length ? this.input[this.pos] : null;
    }

    next() {
      return this.pos < this.length ? this.input[this.pos++] : null;
    }

    tokenize() {
      const tokens = [];

      while (this.pos < this.length) {
        const ch = this.peek();

        // Skip whitespace
        if (/\s/.test(ch)) {
          this.next();
          continue;
        }

        // Bracketed identifier: [field_name]
        if (ch === '[') {
          this.next();
          let name = '';
          while (this.pos < this.length && this.peek() !== ']') {
            name += this.next();
          }
          if (this.peek() === ']') this.next();
          tokens.push({ type: TokenType.IDENTIFIER, value: name.trim() });
          continue;
        }

        // String literals: '...' or "..."
        if (ch === "'" || ch === '"') {
          const quote = this.next();
          let str = '';
          while (this.pos < this.length) {
            const c = this.next();
            if (c === quote) {
              break;
            }
            if (c === '\\' && this.pos < this.length) {
              const esc = this.next();
              if (esc === 'n') str += '\n';
              else if (esc === 't') str += '\t';
              else str += esc;
            } else {
              str += c;
            }
          }
          tokens.push({ type: TokenType.STRING, value: str });
          continue;
        }

        // Geometry variables starting with $
        if (ch === '$') {
          let varName = this.next();
          while (this.pos < this.length && /[a-zA-Z0-9_]/.test(this.peek())) {
            varName += this.next();
          }
          tokens.push({ type: TokenType.GEOM_VAR, value: varName.toLowerCase() });
          continue;
        }

        // Numbers (digits and optional decimal point)
        if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(this.input[this.pos + 1]))) {
          let numStr = '';
          while (this.pos < this.length && /[0-9.]/.test(this.peek())) {
            numStr += this.next();
          }
          tokens.push({ type: TokenType.NUMBER, value: parseFloat(numStr) });
          continue;
        }

        // Identifiers and function names
        if (/[a-zA-Z_\u4e00-\u9fa5]/.test(ch)) {
          let ident = '';
          while (this.pos < this.length && /[a-zA-Z0-9_\u4e00-\u9fa5]/.test(this.peek())) {
            ident += this.next();
          }
          tokens.push({ type: TokenType.IDENTIFIER, value: ident });
          continue;
        }

        // Operators & punctuation
        if (['+', '-', '*', '/'].includes(ch)) {
          tokens.push({ type: TokenType.OPERATOR, value: this.next() });
          continue;
        }

        if (ch === '(') {
          this.next();
          tokens.push({ type: TokenType.LPAREN, value: '(' });
          continue;
        }

        if (ch === ')') {
          this.next();
          tokens.push({ type: TokenType.RPAREN, value: ')' });
          continue;
        }

        if (ch === ',') {
          this.next();
          tokens.push({ type: TokenType.COMMA, value: ',' });
          continue;
        }

        // Unknown character
        throw new Error(`無法識別的字元: '${ch}' (位置 ${this.pos})`);
      }

      tokens.push({ type: TokenType.EOF, value: null });
      return tokens;
    }
  }

  // =========================================================================
  // 2. RECURSIVE-DESCENT AST PARSER
  // =========================================================================

  class SafeExpressionParser {
    constructor(tokens) {
      this.tokens = tokens;
      this.pos = 0;
    }

    peek() {
      return this.tokens[this.pos] || { type: TokenType.EOF, value: null };
    }

    match(type, value = null) {
      const token = this.peek();
      if (token.type !== type) return false;
      if (value !== null && token.value !== value) return false;
      this.pos++;
      return token;
    }

    expect(type, value = null) {
      const token = this.match(type, value);
      if (!token) {
        const cur = this.peek();
        throw new Error(`語法錯誤: 預期 ${value || type}，但遇到 '${cur.value}'`);
      }
      return token;
    }

    parse() {
      if (this.peek().type === TokenType.EOF) {
        throw new Error('表達式不可為空');
      }
      const ast = this.parseExpression();
      if (this.peek().type !== TokenType.EOF) {
        throw new Error(`語法錯誤: 未能解析的剩餘內容 '${this.peek().value}'`);
      }
      return ast;
    }

    // Expression -> Additive
    parseExpression() {
      return this.parseAdditive();
    }

    // Additive -> Multiplicative (('+' | '-') Multiplicative)*
    parseAdditive() {
      let left = this.parseMultiplicative();

      while (true) {
        const op = this.match(TokenType.OPERATOR, '+') || this.match(TokenType.OPERATOR, '-');
        if (!op) break;
        const right = this.parseMultiplicative();
        left = {
          type: 'BinaryOp',
          operator: op.value,
          left,
          right
        };
      }
      return left;
    }

    // Multiplicative -> Unary (('*' | '/') Unary)*
    parseMultiplicative() {
      let left = this.parseUnary();

      while (true) {
        const op = this.match(TokenType.OPERATOR, '*') || this.match(TokenType.OPERATOR, '/');
        if (!op) break;
        const right = this.parseUnary();
        left = {
          type: 'BinaryOp',
          operator: op.value,
          left,
          right
        };
      }
      return left;
    }

    // Unary -> ('-' | '+') Unary | Primary
    parseUnary() {
      const op = this.match(TokenType.OPERATOR, '-') || this.match(TokenType.OPERATOR, '+');
      if (op) {
        const operand = this.parseUnary();
        return {
          type: 'UnaryOp',
          operator: op.value,
          operand
        };
      }
      return this.parsePrimary();
    }

    // Primary -> NUMBER | STRING | GEOM_VAR | FunctionCall | IDENTIFIER | '(' Expression ')'
    parsePrimary() {
      const token = this.peek();

      // Parentheses
      if (this.match(TokenType.LPAREN)) {
        const expr = this.parseExpression();
        this.expect(TokenType.RPAREN, ')');
        return expr;
      }

      // Number literal
      if (token.type === TokenType.NUMBER) {
        this.pos++;
        return { type: 'Literal', value: token.value };
      }

      // String literal
      if (token.type === TokenType.STRING) {
        this.pos++;
        return { type: 'Literal', value: token.value };
      }

      // Geometry variable
      if (token.type === TokenType.GEOM_VAR) {
        this.pos++;
        return { type: 'GeomVariable', name: token.value };
      }

      // Identifier (Field or Function)
      if (token.type === TokenType.IDENTIFIER) {
        this.pos++;
        // Check if function call: name followed by '('
        if (this.match(TokenType.LPAREN)) {
          const args = [];
          if (!this.match(TokenType.RPAREN)) {
            while (true) {
              args.push(this.parseExpression());
              if (this.match(TokenType.COMMA)) continue;
              if (this.match(TokenType.RPAREN)) break;
              throw new Error(`函式 '${token.value}' 參數清單格式錯誤`);
            }
          }
          return {
            type: 'FunctionCall',
            name: token.value.toLowerCase(),
            args
          };
        }

        // Plain field identifier
        return { type: 'Field', name: token.value };
      }

      throw new Error(`無法解析的語法記號: '${token.value}'`);
    }
  }

  // =========================================================================
  // 3. SAFE EVALUATION ENGINE (NO eval, NO Function)
  // =========================================================================

  class SafeEvaluator {
    static evaluate(ast, context) {
      if (!ast) return null;

      switch (ast.type) {
        case 'Literal':
          return ast.value;

        case 'Field': {
          const fieldName = ast.name;
          const props = context.properties || {};
          if (props[fieldName] !== undefined && props[fieldName] !== null) {
            return props[fieldName];
          }
          // Fallback: check case-insensitive match
          const foundKey = Object.keys(props).find(k => k.toLowerCase() === fieldName.toLowerCase());
          if (foundKey && props[foundKey] !== undefined) {
            return props[foundKey];
          }
          return null;
        }

        case 'GeomVariable': {
          const varName = ast.name.toLowerCase();
          const gv = context.geomVars || {};
          return gv[varName] !== undefined ? gv[varName] : null;
        }

        case 'UnaryOp': {
          const val = this.evaluate(ast.operand, context);
          if (val === null || val === undefined) return null;
          const num = Number(val);
          if (isNaN(num)) return null;
          return ast.operator === '-' ? -num : num;
        }

        case 'BinaryOp': {
          const leftVal = this.evaluate(ast.left, context);
          const rightVal = this.evaluate(ast.right, context);

          // Addition / String concatenation
          if (ast.operator === '+') {
            if (typeof leftVal === 'string' || typeof rightVal === 'string') {
              return String(leftVal ?? '') + String(rightVal ?? '');
            }
            if (leftVal === null || rightVal === null || leftVal === undefined || rightVal === undefined) {
              return null;
            }
            const l = Number(leftVal);
            const r = Number(rightVal);
            if (isNaN(l) || isNaN(r)) return null;
            return l + r;
          }

          // Other arithmetic operators require numeric values
          if (leftVal === null || rightVal === null || leftVal === undefined || rightVal === undefined) {
            return null;
          }
          const l = Number(leftVal);
          const r = Number(rightVal);
          if (isNaN(l) || isNaN(r)) return null;

          if (ast.operator === '-') return l - r;
          if (ast.operator === '*') return l * r;
          if (ast.operator === '/') {
            // STRICT DIVISION BY ZERO CHECK: Return null, never Infinity
            if (Math.abs(r) < 1e-12) {
              return null;
            }
            return l / r;
          }
          return null;
        }

        case 'FunctionCall': {
          const funcName = ast.name.toLowerCase();
          const evaluatedArgs = ast.args.map(arg => this.evaluate(arg, context));

          switch (funcName) {
            case 'round': {
              const val = Number(evaluatedArgs[0]);
              if (isNaN(val)) return null;
              const decimals = evaluatedArgs[1] !== undefined ? parseInt(evaluatedArgs[1], 10) : 0;
              const factor = Math.pow(10, isNaN(decimals) ? 0 : Math.max(0, decimals));
              return Math.round(val * factor) / factor;
            }

            case 'abs': {
              const val = Number(evaluatedArgs[0]);
              return isNaN(val) ? null : Math.abs(val);
            }

            case 'min': {
              const nums = evaluatedArgs.map(Number).filter(n => !isNaN(n));
              return nums.length > 0 ? Math.min(...nums) : null;
            }

            case 'max': {
              const nums = evaluatedArgs.map(Number).filter(n => !isNaN(n));
              return nums.length > 0 ? Math.max(...nums) : null;
            }

            case 'coalesce':
            case 'nvl': {
              for (const arg of evaluatedArgs) {
                if (arg !== null && arg !== undefined && arg !== '') return arg;
              }
              return null;
            }

            case 'trim': {
              const str = evaluatedArgs[0];
              return str === null || str === undefined ? null : String(str).trim();
            }

            case 'upper': {
              const str = evaluatedArgs[0];
              return str === null || str === undefined ? null : String(str).toUpperCase();
            }

            case 'lower': {
              const str = evaluatedArgs[0];
              return str === null || str === undefined ? null : String(str).toLowerCase();
            }

            case 'substring':
            case 'substr': {
              const str = evaluatedArgs[0];
              if (str === null || str === undefined) return null;
              const s = String(str);
              let start = parseInt(evaluatedArgs[1], 10);
              if (isNaN(start)) start = 0;
              if (start > 0) start -= 1; // Convert 1-based to 0-based
              start = Math.max(0, start);
              if (evaluatedArgs[2] !== undefined) {
                const len = parseInt(evaluatedArgs[2], 10);
                return isNaN(len) ? s.substring(start) : s.substring(start, start + len);
              }
              return s.substring(start);
            }

            case 'concat': {
              return evaluatedArgs.map(v => (v === null || v === undefined ? '' : String(v))).join('');
            }

            default:
              throw new Error(`不支援的函式: '${funcName}'`);
          }
        }

        default:
          throw new Error(`未知的 AST 節點類型: '${ast.type}'`);
      }
    }

    static extractReferencedFields(ast) {
      const fields = new Set();

      function walk(node) {
        if (!node) return;
        if (node.type === 'Field') {
          fields.add(node.name);
        } else if (node.type === 'BinaryOp') {
          walk(node.left);
          walk(node.right);
        } else if (node.type === 'UnaryOp') {
          walk(node.operand);
        } else if (node.type === 'FunctionCall') {
          node.args.forEach(walk);
        }
      }

      walk(ast);
      return Array.from(fields);
    }
  }

  // =========================================================================
  // 4. SPATIAL GEOMETRY ATTRIBUTE CALCULATOR
  // =========================================================================

  const GeometryUtil = {
    toGeoJSON(featureOrLayer) {
      if (!featureOrLayer) return null;
      if (featureOrLayer.type === 'Feature' && featureOrLayer.geometry) {
        return featureOrLayer;
      }
      if (typeof L !== 'undefined' && L.Circle && featureOrLayer instanceof L.Circle) {
        const latlng = featureOrLayer.getLatLng();
        if (typeof turf !== 'undefined' && turf.circle) {
          return turf.circle([latlng.lng, latlng.lat], featureOrLayer.getRadius() / 1000, { steps: 64, units: 'kilometers' });
        }
      }
      if (featureOrLayer.toGeoJSON) {
        return featureOrLayer.toGeoJSON();
      }
      return null;
    },

    computeVariables(featureOrLayer) {
      const geojson = this.toGeoJSON(featureOrLayer);
      const geom = geojson?.geometry;
      const type = geom?.type || 'Unknown';

      const vars = {
        '$geom_type': type,
        '$area_m2': null,
        '$area_ha': null,
        '$length_m': null,
        '$length_km': null,
        '$perimeter_m': null,
        '$x': null,
        '$y': null,
        '$centroid_x': null,
        '$centroid_y': null,
        '$vertex_count': 0
      };

      if (!geom) return vars;

      // 1. Vertex count
      vars['$vertex_count'] = this.countVertices(geom);

      // 2. Point coordinate or centroid
      if (type === 'Point' && Array.isArray(geom.coordinates)) {
        vars['$x'] = geom.coordinates[0];
        vars['$y'] = geom.coordinates[1];
        vars['$centroid_x'] = geom.coordinates[0];
        vars['$centroid_y'] = geom.coordinates[1];
      } else {
        const centroid = this.calculateCentroid(geom);
        if (centroid) {
          vars['$centroid_x'] = centroid[0];
          vars['$centroid_y'] = centroid[1];
          vars['$x'] = centroid[0];
          vars['$y'] = centroid[1];
        }
      }

      // 3. Area (Polygon, MultiPolygon)
      if (type === 'Polygon' || type === 'MultiPolygon') {
        let area = 0;
        if (typeof turf !== 'undefined' && turf.area) {
          try {
            area = turf.area(geojson);
          } catch (_) {
            area = this.shoelaceAreaMeters(geom);
          }
        } else {
          area = this.shoelaceAreaMeters(geom);
        }
        vars['$area_m2'] = Math.round(area * 100) / 100;
        vars['$area_ha'] = Math.round((area / 10000) * 10000) / 10000;

        // Perimeter
        const perimeter = this.calculatePerimeterMeters(geom);
        vars['$perimeter_m'] = Math.round(perimeter * 100) / 100;
      }

      // 4. Length (LineString, MultiLineString)
      if (type === 'LineString' || type === 'MultiLineString') {
        let length = 0;
        if (typeof turf !== 'undefined' && turf.length) {
          try {
            length = turf.length(geojson, { units: 'meters' });
          } catch (_) {
            length = this.calculateLineLengthMeters(geom);
          }
        } else {
          length = this.calculateLineLengthMeters(geom);
        }
        vars['$length_m'] = Math.round(length * 100) / 100;
        vars['$length_km'] = Math.round((length / 1000) * 10000) / 10000;
      }

      return vars;
    },

    countVertices(geom) {
      if (!geom || !geom.coordinates) return 0;
      let count = 0;
      const countRec = (coords) => {
        if (Array.isArray(coords) && typeof coords[0] === 'number') {
          count++;
        } else if (Array.isArray(coords)) {
          coords.forEach(countRec);
        }
      };
      countRec(geom.coordinates);
      return count;
    },

    calculateCentroid(geom) {
      if (!geom) return null;
      if (typeof turf !== 'undefined' && turf.centroid) {
        try {
          const pt = turf.centroid({ type: 'Feature', geometry: geom });
          return pt.geometry.coordinates;
        } catch (_) {}
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const scan = (coords) => {
        if (Array.isArray(coords) && typeof coords[0] === 'number') {
          const [x, y] = coords;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        } else if (Array.isArray(coords)) {
          coords.forEach(scan);
        }
      };
      scan(geom.coordinates);
      if (!isFinite(minX)) return null;
      return [(minX + maxX) / 2, (minY + maxY) / 2];
    },

    haversineDistanceMeters(c1, c2) {
      const R = 6371008.8;
      const lat1 = (c1[1] * Math.PI) / 180;
      const lat2 = (c2[1] * Math.PI) / 180;
      const dLat = ((c2[1] - c1[1]) * Math.PI) / 180;
      const dLon = ((c2[0] - c1[0]) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },

    calculateLineLengthMeters(geom) {
      let total = 0;
      const lines = geom.type === 'LineString' ? [geom.coordinates] : (geom.coordinates || []);
      for (const line of lines) {
        if (!Array.isArray(line)) continue;
        for (let i = 0; i < line.length - 1; i++) {
          total += this.haversineDistanceMeters(line[i], line[i + 1]);
        }
      }
      return total;
    },

    calculatePerimeterMeters(geom) {
      let total = 0;
      const polys = geom.type === 'Polygon' ? [geom.coordinates] : (geom.coordinates || []);
      for (const rings of polys) {
        if (!Array.isArray(rings)) continue;
        for (const ring of rings) {
          if (!Array.isArray(ring)) continue;
          for (let i = 0; i < ring.length - 1; i++) {
            total += this.haversineDistanceMeters(ring[i], ring[i + 1]);
          }
        }
      }
      return total;
    },

    shoelaceAreaMeters(geom) {
      const R = 6371008.8;
      let totalArea = 0;
      const polys = geom.type === 'Polygon' ? [geom.coordinates] : (geom.coordinates || []);

      for (const rings of polys) {
        if (!Array.isArray(rings) || rings.length === 0) continue;
        const outer = rings[0];
        let outerArea = 0;
        if (outer.length > 2) {
          for (let i = 0; i < outer.length - 1; i++) {
            const p1 = outer[i];
            const p2 = outer[i + 1];
            const dLon = ((p2[0] - p1[0]) * Math.PI) / 180;
            const lat1 = (p1[1] * Math.PI) / 180;
            const lat2 = (p2[1] * Math.PI) / 180;
            outerArea += dLon * (2 + Math.sin(lat1) + Math.sin(lat2));
          }
          outerArea = Math.abs((outerArea * R * R) / 4);
        }
        totalArea += outerArea;
      }
      return totalArea;
    }
  };

  // =========================================================================
  // 5. FIELD CALCULATOR MANAGER
  // =========================================================================

  const FieldCalculator = {
    TokenType,
    SafeExpressionParser,
    SafeEvaluator,
    GeometryUtil,
    BUILTIN_FUNCTIONS,
    GEOMETRY_VARIABLES,

    modal: null,
    currentPreviewData: null,

    init() {
      this.modal = document.getElementById('field-calculator-modal');
      this.bindUi();
    },

    bindUi() {
      document.getElementById('btn-open-field-calc')?.addEventListener('click', () => this.openModal());
      document.getElementById('btn-calc-close')?.addEventListener('click', () => this.closeModal());
      document.getElementById('btn-calc-cancel')?.addEventListener('click', () => this.closeModal());
      document.getElementById('btn-calc-preview')?.addEventListener('click', () => this.runPreview());
      document.getElementById('btn-calc-execute')?.addEventListener('click', () => this.runExecute());

      const targetFieldSelect = document.getElementById('calc-target-field');
      const newFieldCheckbox = document.getElementById('calc-new-field-check');
      const newFieldNameInput = document.getElementById('calc-new-field-name');

      if (newFieldCheckbox) {
        newFieldCheckbox.addEventListener('change', (e) => {
          const isNew = e.target.checked;
          if (newFieldNameInput) newFieldNameInput.disabled = !isNew;
          if (targetFieldSelect) targetFieldSelect.disabled = isNew;
        });
      }
    },

    openModal(defaultTargetField = '') {
      if (!this.modal) this.modal = document.getElementById('field-calculator-modal');
      if (!this.modal) return;

      this.populateFieldLists(defaultTargetField);
      this.clearPreview();
      this.modal.classList.add('active');
    },

    closeModal() {
      if (this.modal) {
        this.modal.classList.remove('active');
      }
    },

    populateFieldLists(defaultTargetField = '') {
      const select = document.getElementById('calc-target-field');
      const helperList = document.getElementById('calc-fields-list');
      const layers = typeof DrawManager !== 'undefined' ? DrawManager.getAllLayers() : [];

      const propKeys = new Set(['name', 'description']);
      layers.forEach(layer => {
        const props = layer.featureProps || {};
        Object.keys(props).forEach(k => {
          if (!['id', 'style', '_measure'].includes(k)) {
            propKeys.add(k);
          }
        });
      });

      const fields = Array.from(propKeys);

      if (select) {
        select.replaceChildren();
        fields.forEach(f => {
          const opt = new Option(f, f);
          if (f === defaultTargetField) opt.selected = true;
          select.add(opt);
        });
      }

      if (helperList) {
        helperList.replaceChildren();
        fields.forEach(f => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'calc-chip calc-field-chip';
          chip.textContent = f;
          chip.title = `點擊插入欄位 [${f}]`;
          chip.addEventListener('click', () => this.insertIntoExpression(`[${f}]`));
          helperList.appendChild(chip);
        });
      }
    },

    insertIntoExpression(text) {
      const textarea = document.getElementById('calc-expression-input');
      if (!textarea) return;

      const start = textarea.selectionStart || 0;
      const end = textarea.selectionEnd || 0;
      const current = textarea.value;
      textarea.value = current.substring(0, start) + text + current.substring(end);
      textarea.focus();
      const newPos = start + text.length;
      textarea.setSelectionRange(newPos, newPos);
    },

    getTargetFeatures(scope = 'all') {
      const allLayers = typeof DrawManager !== 'undefined' ? DrawManager.getAllLayers() : [];
      if (scope === 'selected') {
        if (typeof SelectionManager !== 'undefined') {
          return SelectionManager.getSelectedFeatures();
        }
        return allLayers.filter(l => l.featureProps && DrawManager.selectedLayer === l);
      }
      if (scope === 'filtered') {
        if (typeof TableManager !== 'undefined' && TableManager.drawer) {
          const rows = TableManager.tableBody?.querySelectorAll('tr[data-feature-id]') || [];
          const ids = new Set(Array.from(rows).map(r => r.dataset.featureId).filter(Boolean));
          return allLayers.filter(l => l.featureProps && ids.has(l.featureProps.id));
        }
      }
      return allLayers;
    },

    getAllAvailableFields() {
      const layers = typeof DrawManager !== 'undefined' ? DrawManager.getAllLayers() : [];
      const fields = new Set(['name', 'description', 'geom_type', 'measure']);
      layers.forEach(l => {
        const props = l.featureProps || {};
        Object.keys(props).forEach(k => fields.add(k));
      });
      return fields;
    },

    parseAndValidate(expressionStr, availableFields = null) {
      const lexer = new Lexer(expressionStr);
      const tokens = lexer.tokenize();
      const parser = new SafeExpressionParser(tokens);
      const ast = parser.parse();

      // Check referenced fields
      if (availableFields) {
        const referencedFields = SafeEvaluator.extractReferencedFields(ast);
        for (const field of referencedFields) {
          if (!availableFields.has(field)) {
            throw new Error(`欄位「${field}」不存在於圖層資料中`);
          }
        }
      }

      return ast;
    },

    preview(expressionStr, targetField, scope = 'all', sampleSize = 10) {
      const availableFields = this.getAllAvailableFields();
      const ast = this.parseAndValidate(expressionStr, availableFields);
      const features = this.getTargetFeatures(scope);

      const previewRows = [];
      let successCount = 0;
      let nullCount = 0;
      let errorCount = 0;

      const itemsToTest = features.slice(0, sampleSize);

      for (let i = 0; i < itemsToTest.length; i++) {
        const feature = itemsToTest[i];
        const props = feature.featureProps || {};
        const oldVal = props[targetField] !== undefined ? props[targetField] : null;
        let newVal = null;
        let status = 'ok';
        let errorMsg = '';

        try {
          const geomVars = GeometryUtil.computeVariables(feature);
          newVal = SafeEvaluator.evaluate(ast, {
            properties: props,
            geomVars
          });

          if (newVal === null || newVal === undefined) {
            nullCount++;
            status = 'null';
          } else {
            successCount++;
          }
        } catch (err) {
          errorCount++;
          status = 'error';
          errorMsg = err.message;
        }

        previewRows.push({
          id: props.id || `#${i + 1}`,
          name: props.name || `圖元 #${i + 1}`,
          oldVal,
          newVal,
          status,
          errorMsg
        });
      }

      return {
        previewRows,
        totalScopeCount: features.length,
        sampleCount: itemsToTest.length,
        successCount,
        nullCount,
        errorCount
      };
    },

    execute(expressionStr, targetField, scope = 'all') {
      const cleanField = String(targetField || '').trim();
      if (!cleanField) {
        throw new Error('目標欄位名稱不可為空');
      }

      const availableFields = this.getAllAvailableFields();
      const ast = this.parseAndValidate(expressionStr, availableFields);
      const features = this.getTargetFeatures(scope);

      if (features.length === 0) {
        throw new Error('所選範圍內沒有可計算的圖元');
      }

      // Record undo snapshot before making changes
      if (typeof SafetyManager !== 'undefined') {
        SafetyManager.commitChange(`欄位計算器: 更新「${cleanField}」`);
      }

      let successCount = 0;
      let nullCount = 0;
      let errorCount = 0;

      features.forEach(feature => {
        if (!feature.featureProps) feature.featureProps = {};
        const props = feature.featureProps;

        try {
          const geomVars = GeometryUtil.computeVariables(feature);
          const val = SafeEvaluator.evaluate(ast, {
            properties: props,
            geomVars
          });

          if (val === null || val === undefined) {
            props[cleanField] = null;
            nullCount++;
          } else {
            props[cleanField] = val;
            successCount++;
          }
        } catch (err) {
          props[cleanField] = null;
          errorCount++;
        }

        if (typeof DrawManager !== 'undefined' && DrawManager.updateLayerPopup) {
          DrawManager.updateLayerPopup(feature);
        }
      });

      // Update UI tables
      if (typeof TableManager !== 'undefined' && TableManager.render) {
        TableManager.render();
      }

      return {
        success: true,
        targetField: cleanField,
        totalCount: features.length,
        successCount,
        nullCount,
        errorCount
      };
    },

    updateGeometryFields(scope = 'all') {
      const features = this.getTargetFeatures(scope);
      if (features.length === 0) {
        if (typeof App !== 'undefined') App.showToast('沒有可更新幾何欄位的圖元', 'warning');
        return { updatedCount: 0 };
      }

      if (typeof SafetyManager !== 'undefined') {
        SafetyManager.commitChange('更新幾何欄位');
      }

      features.forEach(feature => {
        if (!feature.featureProps) feature.featureProps = {};
        const props = feature.featureProps;
        const gv = GeometryUtil.computeVariables(feature);

        props['geom_type'] = gv['$geom_type'];
        props['area_m2'] = gv['$area_m2'];
        props['area_ha'] = gv['$area_ha'];
        props['perimeter_m'] = gv['$perimeter_m'];
        props['length_m'] = gv['$length_m'];
        props['centroid_x'] = gv['$centroid_x'];
        props['centroid_y'] = gv['$centroid_y'];
        props['vertex_count'] = gv['$vertex_count'];

        if (typeof DrawManager !== 'undefined' && DrawManager.updateLayerPopup) {
          DrawManager.updateLayerPopup(feature);
        }
      });

      if (typeof TableManager !== 'undefined' && TableManager.render) {
        TableManager.render();
      }

      if (typeof App !== 'undefined') {
        App.showToast(`已為 ${features.length} 個圖元更新幾何資訊欄位`, 'success');
      }

      return { updatedCount: features.length };
    },

    updateGeometryColumnsPrompt() {
      this.updateGeometryFields('all');
    },

    runPreview() {
      const expr = document.getElementById('calc-expression-input')?.value || '';
      const isNewField = document.getElementById('calc-new-field-check')?.checked;
      const targetField = isNewField
        ? (document.getElementById('calc-new-field-name')?.value || '').trim()
        : (document.getElementById('calc-target-field')?.value || '').trim();
      const scope = document.getElementById('calc-scope')?.value || 'all';
      const previewBody = document.getElementById('calc-preview-tbody');
      const statsEl = document.getElementById('calc-preview-stats');
      const confirmBtn = document.getElementById('btn-calc-execute');

      if (!expr.trim()) {
        if (typeof App !== 'undefined') App.showToast('請先輸入計算表達式', 'warning');
        return;
      }
      if (!targetField) {
        if (typeof App !== 'undefined') App.showToast('請選擇或指定目標欄位名稱', 'warning');
        return;
      }

      try {
        const result = this.preview(expr, targetField, scope, 10);
        this.currentPreviewData = { expr, targetField, scope, isNewField };

        if (previewBody) {
          previewBody.replaceChildren();
          result.previewRows.forEach(row => {
            const tr = document.createElement('tr');

            const tdName = document.createElement('td');
            tdName.textContent = row.name;

            const tdOld = document.createElement('td');
            tdOld.textContent = row.oldVal !== null && row.oldVal !== undefined ? String(row.oldVal) : '(空值)';
            tdOld.style.color = '#64748b';

            const tdNew = document.createElement('td');
            tdNew.textContent = row.newVal !== null && row.newVal !== undefined ? String(row.newVal) : '(null)';
            tdNew.style.fontWeight = '600';
            tdNew.style.color = row.status === 'error' ? '#ef4444' : (row.status === 'null' ? '#f59e0b' : '#0284c7');

            const tdStatus = document.createElement('td');
            tdStatus.textContent = row.status === 'ok' ? '成功' : (row.status === 'null' ? '空值' : '錯誤');
            tdStatus.className = `calc-status-${row.status}`;

            tr.append(tdName, tdOld, tdNew, tdStatus);
            previewBody.appendChild(tr);
          });
        }

        if (statsEl) {
          statsEl.textContent = `預覽筆數: ${result.sampleCount}/${result.totalScopeCount} | 成功: ${result.successCount} | 空值: ${result.nullCount} | 錯誤: ${result.errorCount}`;
        }

        if (confirmBtn) confirmBtn.disabled = false;
      } catch (err) {
        if (previewBody) previewBody.replaceChildren();
        if (statsEl) statsEl.textContent = `語法解析失敗: ${err.message}`;
        if (confirmBtn) confirmBtn.disabled = true;
        if (typeof App !== 'undefined') App.showToast(`表達式錯誤: ${err.message}`, 'error');
      }
    },

    runExecute() {
      const expr = document.getElementById('calc-expression-input')?.value || '';
      const isNewField = document.getElementById('calc-new-field-check')?.checked;
      const targetField = isNewField
        ? (document.getElementById('calc-new-field-name')?.value || '').trim()
        : (document.getElementById('calc-target-field')?.value || '').trim();
      const scope = document.getElementById('calc-scope')?.value || 'all';

      try {
        const res = this.execute(expr, targetField, scope);
        if (typeof App !== 'undefined') {
          App.showToast(`欄位「${targetField}」計算完成 (成功 ${res.successCount} 筆, 空值 ${res.nullCount} 筆, 錯誤 ${res.errorCount} 筆)`, 'success');
        }
        this.closeModal();
      } catch (err) {
        if (typeof App !== 'undefined') App.showToast(`執行失敗: ${err.message}`, 'error');
      }
    },

    clearPreview() {
      const previewBody = document.getElementById('calc-preview-tbody');
      const statsEl = document.getElementById('calc-preview-stats');
      const confirmBtn = document.getElementById('btn-calc-execute');
      if (previewBody) previewBody.replaceChildren();
      if (statsEl) statsEl.textContent = '請輸入公式並點擊「預覽前 10 筆」進行檢查。';
      if (confirmBtn) confirmBtn.disabled = true;
    }
  };

  // Export
  if (typeof window !== 'undefined') {
    window.FieldCalculator = FieldCalculator;
  }
  if (typeof global !== 'undefined') {
    global.FieldCalculator = FieldCalculator;
  }
})();
