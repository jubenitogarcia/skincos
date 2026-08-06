'use strict';

const fs = require('fs');
const path = require('path');
const { sha256, text } = require('./contracts');

class InMemoryExecutionStore {
  constructor() {
    this.entries = new Map();
  }

  async get(executionId) {
    const value = this.entries.get(text(executionId));
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  async save(executionId, value) {
    this.entries.set(text(executionId), JSON.parse(JSON.stringify(value)));
    return value;
  }
}

class FileExecutionStore {
  constructor(root) {
    if (!text(root)) throw new Error('FileExecutionStore requires a state root');
    this.root = path.resolve(root);
  }

  filePath(executionId) {
    return path.join(this.root, `${sha256(text(executionId)).slice(0, 48)}.json`);
  }

  async get(executionId) {
    try {
      const content = await fs.promises.readFile(this.filePath(executionId), 'utf8');
      return JSON.parse(content);
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(executionId, value) {
    await fs.promises.mkdir(this.root, { recursive: true });
    const target = this.filePath(executionId);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' });
    await fs.promises.rename(temporary, target);
    return value;
  }
}

module.exports = {
  FileExecutionStore,
  InMemoryExecutionStore,
};
