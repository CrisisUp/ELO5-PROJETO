// Elo5 — modular router: error classes + centralized error handler.
// Zero external deps; used by lib/router.js and route modules.

'use strict';

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // expected/handled errors
    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Recurso não encontrado') {
    super(message, 404, 'NOT_FOUND');
  }
}

class ValidationError extends AppError {
  constructor(message = 'Dados inválidos') {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Não autenticado') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Acesso negado') {
    super(message, 403, 'FORBIDDEN');
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Muitas requisições — tente de novo em instantes') {
    super(message, 429, 'RATE_LIMITED');
  }
}

class InternalError extends AppError {
  constructor(message = 'Erro interno') {
    super(message, 500, 'INTERNAL_ERROR');
    this.isOperational = false; // unexpected
  }
}

// Centralized error handler — replaces inline try/catch + sendJson(res, e.status || 500, ...)
function errorHandler(err, req, res, sendJson) {
  // Log unexpected errors with stack
  if (!err?.isOperational) {
    console.error('[ERROR]', err);
  }

  const status = err?.statusCode ?? 500;
  const code = err?.code ?? 'INTERNAL_ERROR';
  const message = err?.message ?? 'Erro interno';

  // Don't leak internal details in production
  const payload = { error: message, code };
  if (process.env.NODE_ENV !== 'production' && err?.stack) {
    payload.stack = err.stack;
  }

  // Headers already sent? Can't respond.
  if (res.headersSent) {
    return res.destroy();
  }

  sendJson(res, status, payload);
}

module.exports = {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  InternalError,
  errorHandler,
};