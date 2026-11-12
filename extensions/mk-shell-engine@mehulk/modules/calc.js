// MK Shell Engine: the calendar's math bar, its arithmetic. A small recursive-descent parser (never
// eval): numbers (1280, 1.18, .5, 1_000), + - * / % ^ (power, right-associative), x or × for times,
// ÷ for divide, parentheses, unary minus. Anything else: null (the bar shows nothing).
export function evaluate(text) {
    const src = String(text ?? '').replace(/[×x]/g, '*').replace(/÷/g, '/').replace(/_/g, '').trim();
    if (!src || !/^[\d\s.+\-*/%^()]+$/.test(src) || !/\d/.test(src))
        return null;
    let i = 0;
    const peek = () => {
        while (src[i] === ' ')
            i++;
        return src[i];
    };
    const number = () => {
        peek();
        const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
        if (!m)
            throw new Error('number');
        i += m[0].length;
        return parseFloat(m[0]);
    };
    const atom = () => {
        const c = peek();
        if (c === '(') {
            i++;
            const v = sum();
            if (peek() !== ')')
                throw new Error(')');
            i++;
            return v;
        }
        if (c === '-') {
            i++;
            return -atom();
        }
        if (c === '+') {
            i++;
            return atom();
        }
        return number();
    };
    const power = () => {
        const base = atom();
        if (peek() === '^') {
            i++;
            return base ** unary();           // (right-associative: 2^3^2 = 2^9)
        }
        return base;
    };
    const unary = () => {
        if (peek() === '-') {
            i++;
            return -unary();
        }
        return power();
    };
    const product = () => {
        let v = unary();
        for (let c = peek(); c === '*' || c === '/' || c === '%'; c = peek()) {
            i++;
            const r = unary();
            v = c === '*' ? v * r : c === '/' ? v / r : v % r;
        }
        return v;
    };
    const sum = () => {
        let v = product();
        for (let c = peek(); c === '+' || c === '-'; c = peek()) {
            i++;
            const r = product();
            v = c === '+' ? v + r : v - r;
        }
        return v;
    };
    try {
        const v = sum();
        if (peek() !== undefined || !Number.isFinite(v))
            return null;
        return v;
    } catch {
        return null;
    }
}

// "1,510.4", "0.333333333", "-12": at most 10 significant digits, thousands grouped
export function format(v) {
    if (v === null)
        return '';
    const rounded = Number(v.toPrecision(10));
    return Math.abs(rounded) >= 1e15 || (Math.abs(rounded) < 1e-6 && rounded !== 0)
        ? rounded.toExponential(6)
        : rounded.toLocaleString('en-US', {maximumFractionDigits: 9});
}
