import { logger } from '../utils/logger';
import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DataSetup {
  type: 'config' | 'entity' | 'file';
  path?: string;
  createIfMissing?: boolean;
  content?: any;
  entityType?: string;
  entityId?: string;
  fields?: Record<string, any>;
}

export interface ConfigEntityData {
  entityType: string;
  entityId: string;
  data: any;
}

/**
 * TestDataManager manages test data setup and cleanup.
 *
 * Supports:
 * - Config entity creation/deletion
 * - Test entity creation with markers
 * - Test artifact cleanup
 * - Test isolation
 */
export class TestDataManager {
  private debug: boolean;
  private testDataPath: string;
  private createdEntities: Array<{ type: string; id: string }> = [];

  constructor(debug: boolean = false) {
    this.debug = debug;
    this.testDataPath = path.join(process.cwd(), '.devloop', 'test-data');
  }

  /**
   * Setup test data.
   */
  async setupTestData(dataSetup: DataSetup[], taskId: string): Promise<void> {
    if (this.debug) {
      logger.debug(`[TestDataManager] Setting up test data for task: ${taskId}`);
    }

    for (const setup of dataSetup) {
      try {
        switch (setup.type) {
          case 'config':
            await this.createConfigEntity(setup);
            break;

          case 'entity':
            await this.createTestEntity(setup, taskId);
            break;

          case 'file':
            await this.createTestFile(setup);
            break;
        }
      } catch (error: any) {
        logger.warn(`[TestDataManager] Failed to setup test data: ${error.message}`);
        throw error;
      }
    }
  }

  /**
   * Cleanup test data.
   */
  async cleanupTestData(dataSetup: DataSetup[], taskId: string): Promise<void> {
    if (this.debug) {
      logger.debug(`[TestDataManager] Cleaning up test data for task: ${taskId}`);
    }

    // Cleanup created entities in reverse order
    for (let i = this.createdEntities.length - 1; i >= 0; i--) {
      const entity = this.createdEntities[i];
      try {
        await this.deleteConfigEntity(entity.type, entity.id);
      } catch (error: any) {
        logger.warn(`[TestDataManager] Failed to cleanup entity ${entity.type}:${entity.id}: ${error.message}`);
      }
    }

    this.createdEntities = [];
  }

  /**
   * Create a config entity.
   */
  async createConfigEntity(config: DataSetup): Promise<void> {
    if (!config.path) {
      throw new Error('Config entity requires path');
    }

    const fullPath = path.resolve(process.cwd(), config.path);

    // Create directory if needed
    await fs.ensureDir(path.dirname(fullPath));

    // Write config file
    if (config.content) {
      const yaml = require('yaml');
      const content = yaml.stringify(config.content);
      await fs.writeFile(fullPath, content, 'utf-8');
    } else if (config.createIfMissing) {
      // Create empty config file
      await fs.writeFile(fullPath, '', 'utf-8');
    }

    // Import config via Drush
    const configName = path.basename(fullPath, path.extname(fullPath));
    const command = `ddev exec bash -c "drush config:import --source=${path.dirname(fullPath)} --partial"`;

    try {
      await execAsync(command, { timeout: 60000 });
    } catch (error: any) {
      // Config import may fail if config already exists, that's OK
      if (this.debug) {
        logger.debug(`[TestDataManager] Config import result: ${error.message}`);
      }
    }

    // Track created entity
    if (config.entityType && config.entityId) {
      this.createdEntities.push({
        type: config.entityType,
        id: config.entityId,
      });
    }
  }

  /**
   * Create a test entity.
   */
  async createTestEntity(entity: DataSetup, taskId: string): Promise<void> {
    if (!entity.entityType || !entity.entityId) {
      throw new Error('Test entity requires entityType and entityId');
    }

    // Mark entity as test data
    const fields = {
      ...entity.fields,
      _test_marker: taskId,
      _test_created: new Date().toISOString(),
    };

    // Create entity via Drush
    const command = `ddev exec bash -c "drush entity:create ${entity.entityType} ${entity.entityId} --fields='${JSON.stringify(fields)}'"`;

    try {
      await execAsync(command, { timeout: 60000 });
      this.createdEntities.push({
        type: entity.entityType,
        id: entity.entityId,
      });
    } catch (error: any) {
      // Entity creation may fail if entity already exists
      if (this.debug) {
        logger.debug(`[TestDataManager] Entity creation result: ${error.message}`);
      }
    }
  }

  /**
   * Create a test file.
   */
  async createTestFile(file: DataSetup): Promise<void> {
    if (!file.path) {
      throw new Error('Test file requires path');
    }

    const fullPath = path.resolve(process.cwd(), file.path);

    // Create directory if needed
    await fs.ensureDir(path.dirname(fullPath));

    // Write file content
    if (file.content) {
      if (typeof file.content === 'string') {
        await fs.writeFile(fullPath, file.content, 'utf-8');
      } else {
        const yaml = require('yaml');
        const content = yaml.stringify(file.content);
        await fs.writeFile(fullPath, content, 'utf-8');
      }
    } else if (file.createIfMissing) {
      // Create empty file
      await fs.writeFile(fullPath, '', 'utf-8');
    }
  }

  /**
   * Delete a config entity.
   */
  async deleteConfigEntity(entityType: string, entityId: string): Promise<void> {
    try {
      const command = `ddev exec bash -c "drush entity:delete ${entityType} ${entityId}"`;
      await execAsync(command, { timeout: 60000 });
    } catch (error: any) {
      // Entity may not exist, that's OK
      if (this.debug) {
        logger.debug(`[TestDataManager] Entity deletion result: ${error.message}`);
      }
    }
  }
}






