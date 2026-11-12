import { describe, expect, it } from 'vitest';
import { calcDisplay } from './calcModel';

const block = (id: string, name: string, expr: string) => ({ id, name, expr });
/** Display text of the first block among `blocks`. */
const show = (...blocks: ReturnType<typeof block>[]) => {
  const first = blocks[0];
  if (!first) throw new Error('no block');
  return calcDisplay(first, blocks, 'RU');
};
const num = (s: string) => s.replace(/\s/g, ' ');

describe('note formulas: arithmetic', () => {
  it('follows operator precedence and parentheses', () => {
    expect(show(block('a', 'x', '2+3*4')).text).toBe('= 14');
    expect(show(block('a', 'x', '(2+3)*4')).text).toBe('= 20');
    expect(show(block('a', 'x', '-3+10%4')).text).toBe('= -1');
  });
  it('reads a comma as the decimal point and rounds to two places', () => {
    expect(show(block('a', 'x', '1,5*2')).text).toBe('= 3');
    expect(show(block('a', 'x', '10/3')).text).toBe('= 3,33');
    expect(num(show(block('a', 'x', '1234,5')).text)).toBe('= 1 234,5');
  });
  it('shows nothing for an empty formula and a dash for an error', () => {
    expect(show(block('a', 'x', '   '))).toEqual({ text: '', title: '' });
    expect(show(block('a', 'x', '1/0')).text).toBe('—');
    expect(show(block('a', 'x', '(1+2')).text).toBe('—');
  });
});

describe('note formulas: blocks refer to each other by name', () => {
  it('uses other blocks, names without spaces, longest name first', () => {
    expect(show(block('a', 'total', 'price*qty'), block('b', 'price', '2,5'), block('c', 'qty', '4')).text).toBe('= 10');
    expect(show(block('a', 'sum', 'a b+a'), block('b', 'a b', '10'), block('c', 'a', '1')).text).toBe('= 11');
  });
  it('names a circular reference and an unknown variable', () => {
    const cyc = show(block('a', 'x', 'y+1'), block('b', 'y', 'x+1'));
    expect(cyc.text).toBe('—');
    expect(cyc.title).toBe('Круговая ссылка');
    const unknown = show(block('a', 'x', 'z*2'));
    expect(unknown.title).toBe('Нет такой переменной: z');
  });
});
