/**
 * SQLite 兼容层
 * 优先使用 better-sqlite3（需 C++ 编译）；失败则回退到 node:sqlite（Node.js 内置，免编译）
 *
 * 两者的 API 差异通过此层抹平：
 *  - pragma(): node:sqlite 无此方法，改用 exec('PRAGMA ...')
 *  - transaction(): node:sqlite 无此方法，手动实现 BEGIN/COMMIT/ROLLBACK
 */
let Database;

try {
  // 优先尝试 better-sqlite3（已编译安装时）
  Database = require('better-sqlite3');
  module.exports = Database;
  module.exports._backend = 'better-sqlite3';
} catch (e) {
  // 回退到 node:sqlite（Node.js 22.5+ 内置，无需编译）
  const { DatabaseSync } = require('node:sqlite');

  /**
   * 兼容 better-sqlite3 的 Database 包装类
   */
  class CompatibleDatabase extends DatabaseSync {
    constructor(path, options) {
      // node:sqlite 的 options 与 better-sqlite3 不同，只传 path
      super(path);
    }

    /**
     * 兼容 better-sqlite3 的 pragma() 方法
     */
    pragma(str, options) {
      const query = str.trim();
      if (query.includes('=') || query.toLowerCase().startsWith('journal_mode') ||
          query.toLowerCase().startsWith('foreign_keys')) {
        try {
          this.exec('PRAGMA ' + query);
        } catch (e) { /* 忽略 PRAGMA 错误 */ }
        return [];
      }
      try {
        return this.prepare('PRAGMA ' + query).all();
      } catch (e) {
        return [];
      }
    }

    /**
     * 兼容 better-sqlite3 的 transaction() 方法
     */
    transaction(fn) {
      const self = this;
      return function (...args) {
        self.exec('BEGIN');
        try {
          const result = fn.apply(this, args);
          self.exec('COMMIT');
          return result;
        } catch (err) {
          try { self.exec('ROLLBACK'); } catch (e) {}
          throw err;
        }
      };
    }
  }

  Database = CompatibleDatabase;
  module.exports = Database;
  module.exports._backend = 'node:sqlite';
}