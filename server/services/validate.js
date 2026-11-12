import { ValidationError } from '../lib/time.js';

export function str(value, name, { required = false, max = 5000, allowEmpty = true } = {}) {
  if (value == null) {
    if (required) throw new ValidationError(`${name} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ValidationError(`${name} must be a string.`);
  const v = value.trim();
  if ((required || !allowEmpty) && !v) throw new ValidationError(`${name} cannot be empty.`);
  if (v.length > max) throw new ValidationError(`${name} must be at most ${max} characters.`);
  return v;
}

export function oneOf(value, name, allowed, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new ValidationError(`${name} is required.`);
    return undefined;
  }
  if (!allowed.includes(value)) throw new ValidationError(`${name} must be one of: ${allowed.join(', ')}.`);
  return value;
}

export function id(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new ValidationError(`${name} must be a positive integer.`);
  return n;
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}
