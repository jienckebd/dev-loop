import * as fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'yaml';
import { PrdMetadata } from './prd-config-parser';
import { logger } from './logger';

/**
 * Entity Generator Service
 * 
 * Generates BD entity type YAML configuration files from PRD entityGeneration config.
 * Reads entityGeneration frontmatter and creates bd.entity_type.*.yml and bd.bundle.*.yml files.
 */
export class EntityGenerator {
  private configDir: string;
  private debug: boolean;

  constructor(configDir: string = 'config/default', debug: boolean = false) {
    this.configDir = configDir;
    this.debug = debug;
  }

  /**
   * Generate entity type and bundle configs from PRD metadata
   */
  async generateFromPrd(metadata: PrdMetadata, projectRoot: string): Promise<void> {
    if (!metadata.entityGeneration) {
      if (this.debug) {
        logger.debug('[EntityGenerator] No entityGeneration config found in PRD');
      }
      return;
    }

    const entityGen = metadata.entityGeneration;
    const configPath = path.join(projectRoot, this.configDir);

    // Ensure config directory exists
    await fs.ensureDir(configPath);

    // Generate entity type config
    if (entityGen.entityType) {
      await this.generateEntityType(entityGen.entityType, configPath);
    }

    // Generate bundle configs
    if (entityGen.bundles && entityGen.bundles.length > 0) {
      for (const bundle of entityGen.bundles) {
        await this.generateBundle(
          bundle,
          entityGen.entityType?.id || 'unknown',
          configPath,
          entityGen.fieldMappings
        );
      }
    }
  }

  /**
   * Generate entity type YAML config
   */
  private async generateEntityType(
    entityType: any,
    configPath: string
  ): Promise<void> {
    if (!entityType) {
      return;
    }

    const fileName = `bd.entity_type.${entityType.id}.yml`;
    const filePath = path.join(configPath, fileName);

    // Build entity type config
    const config: any = {
      label: entityType.label,
      id: entityType.id,
      type: entityType.type,
      plural_label: `${entityType.label}s`,
      description: `Auto-generated from PRD entityGeneration config`,
    };

    // Add base template if specified
    if (entityType.base) {
      config.base = entityType.base;
    }

    // Add route configuration
    config.route = {
      base_path_content: `/admin/config/services/${entityType.id.replace(/_/g, '-')}`,
    };

    // Add handlers
    config.handlers = {
      list_builder: 'Drupal\\bd\\Entity\\EntityListBuilder',
      form: {
        default: 'Drupal\\bd\\Form\\ConfigEntityForm',
        add: 'Drupal\\bd\\Form\\ConfigEntityForm',
        edit: 'Drupal\\bd\\Form\\ConfigEntityForm',
        delete: 'Drupal\\Core\\Entity\\EntityDeleteForm',
      },
      route_provider: {
        html: 'Drupal\\Core\\Entity\\Routing\\AdminHtmlRouteProvider',
      },
    };

    // Add menu
    config.menu = {
      items: [
        {
          menu_type: 'link',
          title: entityType.label,
          parent: 'system.admin_config_services',
          weight: 10,
        },
      ],
    };

    // Add Schema.org third-party settings if specified
    if (entityType.schemaOrg) {
      config.third_party_settings = config.third_party_settings || {};
      config.third_party_settings.schemadotorg = {
        schema_type: entityType.schemaOrg.type,
        schema_subtype: entityType.schemaOrg.subtype,
      };
    }

    // Write YAML file
    const yamlContent = yaml.stringify(config, { indent: 2, lineWidth: 0 });
    await fs.writeFile(filePath, yamlContent, 'utf-8');

    if (this.debug) {
      logger.debug(`[EntityGenerator] Generated entity type config: ${filePath}`);
    }
  }

  /**
   * Generate bundle YAML config
   */
  private async generateBundle(
    bundle: any,
    entityTypeId: string,
    configPath: string,
    fieldMappings?: Record<string, any>
  ): Promise<void> {
    const fileName = `bd.bundle.${entityTypeId}.${bundle.bundleId}.yml`;
    const filePath = path.join(configPath, fileName);

    // Build bundle config
    const config: any = {
      label: bundle.label,
      id: bundle.bundleId,
      entity_type: entityTypeId,
      description: `Auto-generated bundle from PRD for schema: ${bundle.schemaName}`,
    };

    // Add Schema.org mapping if specified
    if (bundle.schemaOrg) {
      config.third_party_settings = config.third_party_settings || {};
      config.third_party_settings.schemadotorg = {
        schema_type: bundle.schemaOrg.type,
      };

      // Add property mappings if specified
      if (bundle.schemaOrg.properties) {
        config.third_party_settings.schemadotorg.schema_properties = bundle.schemaOrg.properties;
      }
    }

    // Add OpenAPI entity reference if schemaName is provided
    if (bundle.schemaName) {
      config.third_party_settings = config.third_party_settings || {};
      config.third_party_settings.openapi_entity = {
        component_schema_id: bundle.schemaName,
        schema_label: bundle.label,
      };
    }

    // Write YAML file
    const yamlContent = yaml.stringify(config, { indent: 2, lineWidth: 0 });
    await fs.writeFile(filePath, yamlContent, 'utf-8');

    if (this.debug) {
      logger.debug(`[EntityGenerator] Generated bundle config: ${filePath}`);
    }
  }

  /**
   * Generate field storage and field configs from OpenAPI schema
   * This would be called separately after bundles are created
   */
  async generateFieldsFromOpenApi(
    schema: any,
    entityTypeId: string,
    bundleId: string,
    fieldMappings?: Record<string, any>
  ): Promise<void> {
    // This would parse OpenAPI schema and generate field.field.*.yml files
    // Implementation depends on OpenAPI schema structure
    if (this.debug) {
      logger.debug(`[EntityGenerator] Field generation from OpenAPI not yet implemented`);
    }
  }
}