import * as fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'yaml';
import { PrdMetadata } from './prd-config-parser';
import { logger } from './logger';

/**
 * Schema.org Mapper Service
 * 
 * Generates schemadotorg_mapping and schemadotorg_mapping_type config entities
 * from PRD schemaOrg frontmatter configuration.
 */
export class SchemaOrgMapper {
  private configDir: string;
  private debug: boolean;

  constructor(configDir: string = 'config/default', debug: boolean = false) {
    this.configDir = configDir;
    this.debug = debug;
  }

  /**
   * Generate Schema.org mapping configs from PRD metadata
   */
  async generateFromPrd(metadata: PrdMetadata, projectRoot: string): Promise<void> {
    if (!metadata.schemaOrg) {
      if (this.debug) {
        logger.debug('[SchemaOrgMapper] No schemaOrg config found in PRD');
      }
      return;
    }

    const schemaOrg = metadata.schemaOrg;
    const configPath = path.join(projectRoot, this.configDir);

    // Ensure config directory exists
    await fs.ensureDir(configPath);

    // Generate mapping types for each entity type
    if (schemaOrg.typeMappings) {
      for (const [entityTypeId, mapping] of Object.entries(schemaOrg.typeMappings)) {
        await this.generateMappingType(entityTypeId, configPath);

        // Generate mappings for bundles (would need bundle info from entityGeneration)
        if (metadata.entityGeneration?.bundles) {
          for (const bundle of metadata.entityGeneration.bundles) {
            await this.generateMapping(
              entityTypeId,
              bundle.bundleId,
              mapping,
              bundle.schemaOrg,
              configPath
            );
          }
        }
      }
    }

    // Generate custom vocabulary if specified
    if (schemaOrg.customVocabulary) {
      await this.generateCustomVocabulary(schemaOrg.customVocabulary, configPath);
    }
  }

  /**
   * Generate schemadotorg_mapping_type config
   */
  private async generateMappingType(
    entityTypeId: string,
    configPath: string
  ): Promise<void> {
    const fileName = `schemadotorg_mapping_type.${entityTypeId}.yml`;
    const filePath = path.join(configPath, fileName);

    // Check if file already exists
    if (await fs.pathExists(filePath)) {
      if (this.debug) {
        logger.debug(`[SchemaOrgMapper] Mapping type already exists: ${filePath}`);
      }
      return;
    }

    const config: any = {
      id: entityTypeId,
      target_entity_type_id: entityTypeId,
      status: true,
      multiple: true,
      label_prefix: '',
      id_prefix: '',
      default_component_weights_update: '',
    };

    const yamlContent = yaml.stringify(config, { indent: 2, lineWidth: 0 });
    await fs.writeFile(filePath, yamlContent, 'utf-8');

    if (this.debug) {
      logger.debug(`[SchemaOrgMapper] Generated mapping type: ${filePath}`);
    }
  }

  /**
   * Generate schemadotorg_mapping config for a bundle
   */
  private async generateMapping(
    entityTypeId: string,
    bundleId: string,
    typeMapping: any,
    bundleSchemaOrg?: { type?: string; properties?: Record<string, string> },
    configPath?: string
  ): Promise<void> {
    if (!configPath) {
      return;
    }

    const mappingId = `${entityTypeId}.${bundleId}`;
    const fileName = `schemadotorg_mapping.${mappingId}.yml`;
    const filePath = path.join(configPath, fileName);

    // Check if file already exists
    if (await fs.pathExists(filePath)) {
      if (this.debug) {
        logger.debug(`[SchemaOrgMapper] Mapping already exists: ${filePath}`);
      }
      return;
    }

    const schemaType = bundleSchemaOrg?.type || typeMapping.type;

    if (!schemaType) {
      if (this.debug) {
        logger.debug(`[SchemaOrgMapper] No schema type specified for ${mappingId}, skipping`);
      }
      return;
    }

    const config: any = {
      id: mappingId,
      target_entity_type_id: entityTypeId,
      target_bundle: bundleId,
      status: true,
      schema_type: schemaType,
    };

    // Add schema properties if specified
    if (bundleSchemaOrg?.properties) {
      config.schema_properties = bundleSchemaOrg.properties;
    } else if (typeMapping.properties) {
      config.schema_properties = typeMapping.properties;
    }

    // Add subtypes if specified
    if (typeMapping.subTypes && typeMapping.subTypes.length > 0) {
      config.schema_subtype = typeMapping.subTypes[0]; // Primary subtype
      // Note: Schema.org module may support multiple subtypes differently
    }

    const yamlContent = yaml.stringify(config, { indent: 2, lineWidth: 0 });
    await fs.writeFile(filePath, yamlContent, 'utf-8');

    if (this.debug) {
      logger.debug(`[SchemaOrgMapper] Generated mapping: ${filePath}`);
    }
  }

  /**
   * Generate custom vocabulary extension config
   * Note: This is a placeholder - actual custom vocabulary implementation depends on schemadotorg module
   */
  private async generateCustomVocabulary(
    vocabulary: any,
    configPath: string
  ): Promise<void> {
    if (!vocabulary || !vocabulary.terms) {
      return;
    }

    // Custom vocabulary terms would typically be stored in a separate config
    // This is a placeholder implementation
    const fileName = `schemadotorg_vocabulary.${vocabulary.prefix}.yml`;
    const filePath = path.join(configPath, fileName);

    const config: any = {
      prefix: vocabulary.prefix,
      namespace: vocabulary.namespace,
      terms: vocabulary.terms.map((term: any) => ({
        id: term.id,
        label: term.label,
        subClassOf: term.subClassOf,
      })),
    };

    const yamlContent = yaml.stringify(config, { indent: 2, lineWidth: 0 });
    await fs.writeFile(filePath, yamlContent, 'utf-8');

    if (this.debug) {
      logger.debug(`[SchemaOrgMapper] Generated custom vocabulary: ${filePath}`);
    }
  }

  /**
   * Apply property mappings to existing mappings
   */
  async applyPropertyMappings(
    propertyMappings: Record<string, string>,
    projectRoot: string
  ): Promise<void> {
    // This would update existing schemadotorg_mapping files with property mappings
    // Implementation would read mapping files and update schema_properties
    if (this.debug) {
      logger.debug(`[SchemaOrgMapper] Property mapping application not yet fully implemented`);
    }
  }
}