# Schema Processor PRD Execution Checklist

This checklist ensures all PRDs are ready for dev-loop execution with proper validation at each phase.

## Pre-Execution Validation

### Environment Setup

- [ ] DDEV is running and accessible
- [ ] Drupal is installed and bootstrapped
- [ ] All required modules are enabled
- [ ] Cache can be cleared (`ddev exec bash -c "drush cr"`)

### Infrastructure Validation

- [ ] Run `ddev exec bash -c "php script/validate-prd-prerequisites.php"` - should return success
- [ ] Run `ddev exec bash -c "php script/validate-schema.php"` - should return success (may have warnings for missing files that will be created)
- [ ] Test validation gates: `php script/validate-gates.php no-php-errors`
- [ ] Test validation gates: `php script/validate-gates.php schema-validates`
- [ ] Test validation gates: `php script/validate-gates.php plugin-types-discoverable`

### Test Infrastructure

- [ ] Playwright is installed (`npx playwright --version`)
- [ ] Test helpers exist in `tests/playwright/bd/helpers/`
- [ ] Test files exist:
  - [ ] `tests/playwright/bd/schema-processor-foundation.spec.ts`
  - [ ] `tests/playwright/bd/schema-processor-core-processors.spec.ts`
  - [ ] `tests/playwright/bd/schema-processor-integration-1.spec.ts`
  - [ ] `tests/playwright/bd/schema-processor-advanced-processors.spec.ts`
  - [ ] `tests/playwright/bd/schema-processor-final-integration.spec.ts`

### PRD Validation

- [ ] PRD 1 passes dev-loop PRD schema v1.2 validation
- [ ] PRD 2 passes dev-loop PRD schema v1.2 validation
- [ ] PRD 3 passes dev-loop PRD schema v1.2 validation
- [ ] PRD 4 passes dev-loop PRD schema v1.2 validation
- [ ] PRD 5 passes dev-loop PRD schema v1.2 validation
- [ ] All PRD dependencies are correctly specified
- [ ] All test file references are correct
- [ ] All validation gate commands are properly escaped

## Per-Phase Validation

### After Each Phase Completion

1. **Run Validation Gates**
   - [ ] `php script/validate-gates.php no-php-errors`
   - [ ] `php script/validate-gates.php schema-validates`
   - [ ] `php script/validate-gates.php plugin-types-discoverable` (if applicable)

2. **Run Phase-Level Tests**
   - [ ] Execute phase-level Playwright tests from appropriate test file
   - [ ] All tests pass

3. **Verify Schema Validation**
   - [ ] `ddev exec bash -c "php script/validate-schema.php"` passes
   - [ ] No PHP errors in logs

4. **Check Cache**
   - [ ] `ddev exec bash -c "drush cr"` completes successfully

### PRD 1: Schema Foundation - Phase 1

- [ ] Schema processor plugin type registered
- [ ] Condition plugin type registered
- [ ] ValidationRule plugin type registered
- [ ] SchemaProcessorManager class exists with required methods
- [ ] Schema processor schema files created
- [ ] Plugin types defined in `bd.plugin_type.yml`
- [ ] Run `tests/playwright/bd/schema-processor-foundation.spec.ts` - Phase 1 tests pass
- [ ] Run `tests/playwright/bd/schema-processor-foundation.spec.ts` - PRD 1 tests pass

### PRD 2: Core Processors

#### Phase 2: Entity Display Processors
- [ ] Generic processors (transform, conditional, property_setter) configured for entity display
- [ ] Specialized processors (FormHandlerProcessor, AjaxBehaviorProcessor, etc.) created where needed
- [ ] Processor chain executes in correct order
- [ ] Entity display features work in UI
- [ ] Run phase 2 tests from `schema-processor-core-processors.spec.ts`

#### Phase 3: Field Feature Processors
- [ ] Generic processors (options, conditional, transform, sequence) configured for field features
- [ ] Field processor chain complete
- [ ] Run phase 3 tests from `schema-processor-core-processors.spec.ts`

#### Phase 4: Field Definition Processors
- [ ] Generic processors (field_definition, merge, cleanup) configured for field definitions
- [ ] Run phase 4 tests from `schema-processor-core-processors.spec.ts`

#### Phase 5: Entity Operation & Context Processors
- [ ] Generic processors (generator, transform, conditional, sequence) configured for entity operations
- [ ] Generic processors (transform, sequence) configured for entity context
- [ ] Specialized processors (ContextAggregatorProcessor) created where needed
- [ ] Run phase 5 tests from `schema-processor-core-processors.spec.ts`

#### PRD 2 Completion
- [ ] All generic processors configured (transform, conditional, property_setter, options, sequence, generator, field_definition, merge, cleanup)
- [ ] Specialized processors created only where generic processors insufficient
- [ ] Service methods refactored to use processors
- [ ] Run PRD 2 tests from `schema-processor-core-processors.spec.ts`

### PRD 3: Integration 1 - Phase 6

- [ ] All Playwright test suites passing
- [ ] Nested sequences handled correctly
- [ ] Plugin chains work correctly
- [ ] Conditional logic (AND/OR/XOR) works
- [ ] Context-aware processing works
- [ ] Config_schema_set patterns work
- [ ] Run phase 6 tests from `schema-processor-integration-1.spec.ts`
- [ ] Run PRD 3 tests from `schema-processor-integration-1.spec.ts`
- [ ] No regressions in existing functionality

### PRD 4: Advanced Processors

#### Phase 7: Entity Type Schema Processors
- [ ] Generic processors (merge, cleanup, property_setter, transform, link, tag) configured for entity types
- [ ] Specialized processors (EntityTypeDefinitionAdditionProcessor, EntityTypeStorageHandlerProcessor) created where needed
- [ ] Run phase 7 tests from `schema-processor-advanced-processors.spec.ts`

#### Phase 8: Computed Field Schema Processors
- [ ] Generic processors (plugin_instance_extractor, field_definition, property_setter, transform) configured for computed fields
- [ ] Specialized processors (ComputedFieldSettingsProcessor, ComputedFieldClassMapperProcessor) created where needed
- [ ] Run phase 8 tests from `schema-processor-advanced-processors.spec.ts`

#### Phase 9: Field Set Schema Processors
- [ ] Generic processors (sequence, transform) configured for field sets
- [ ] Run phase 9 tests from `schema-processor-advanced-processors.spec.ts`

#### PRD 4 Completion
- [ ] All generic processors configured (merge, cleanup, property_setter, transform, link, tag, plugin_instance_extractor, field_definition, sequence)
- [ ] Specialized processors created only where generic processors insufficient
- [ ] Run PRD 4 tests from `schema-processor-advanced-processors.spec.ts`

### PRD 5: Final Integration - Phase 10

- [ ] All generic processors (10 total) working together
- [ ] All specialized processors (5-10 total) working together
- [ ] Total processor count: ~15-20 (down from 50+)
- [ ] Cross-processor validation passing
- [ ] System-wide performance validation passing
- [ ] All test suites passing
- [ ] Run phase 10 tests from `schema-processor-final-integration.spec.ts`
- [ ] Run PRD 5 tests from `schema-processor-final-integration.spec.ts`
- [ ] Production readiness validated

## Post-Execution Validation

### After All PRDs Complete

1. **Full Test Suite**
   - [ ] Run all validation test files
   - [ ] All tests pass

2. **File Validation**
   - [ ] All created files exist
   - [ ] All modified files are correct

3. **Integration Validation**
   - [ ] Cross-PRD integration works
   - [ ] System-wide functionality verified

4. **Performance Validation**
   - [ ] System performance within acceptable thresholds
   - [ ] No memory leaks or infinite loops

5. **Documentation**
   - [ ] All documentation updated
   - [ ] Execution checklist completed

## Common Issues and Solutions

### Issue: Schema validation fails

**Symptoms**: `script/validate-schema.php` returns errors

**Solutions**:
1. Check YAML syntax in schema files
2. Verify schema file paths are correct
3. Clear Drupal cache: `ddev exec bash -c "drush cr"`
4. Check TypedConfigManager can discover schemas

### Issue: Plugin type not discoverable

**Symptoms**: `plugin-types-discoverable` validation gate fails

**Solutions**:
1. Verify plugin type is defined in `bd.plugin_type.yml`
2. Check plugin manager service ID is correct
3. Clear Drupal cache
4. Verify service container has the plugin manager service

### Issue: Methods don't exist

**Symptoms**: `methods-exist` validation gate fails

**Solutions**:
1. Verify class file exists
2. Check method is defined in class
3. Verify service is correctly registered
4. Clear Drupal cache

### Issue: Test failures

**Symptoms**: Playwright tests fail

**Solutions**:
1. Check Drupal logs for PHP errors
2. Verify test data setup is correct
3. Check test isolation (cleanup between tests)
4. Verify test helpers are working correctly
5. Check for timing issues (add appropriate waits)

### Issue: Processor not found

**Symptoms**: Processor existence check fails

**Solutions**:
1. Verify processor plugin annotation is correct
2. Check processor is registered for the correct hook
3. Verify processor configuration is valid
4. Clear Drupal cache
5. Check SchemaProcessorManager discovery logic

## Validation Commands Reference

```bash
# Prerequisite validation
ddev exec bash -c "php script/validate-prd-prerequisites.php"

# Schema validation
ddev exec bash -c "php script/validate-schema.php"

# Validation gates
php script/validate-gates.php no-php-errors
php script/validate-gates.php schema-validates
php script/validate-gates.php plugin-types-discoverable
php script/validate-gates.php methods-exist <service_id> <method1> <method2>

# Cache clearing
ddev exec bash -c "drush cr"

# Log checking
ddev logs -s web | grep -i "PHP Fatal"

# Test execution
npx playwright test tests/playwright/bd/schema-processor-foundation.spec.ts
npx playwright test tests/playwright/bd/schema-processor-core-processors.spec.ts
npx playwright test tests/playwright/bd/schema-processor-integration-1.spec.ts
npx playwright test tests/playwright/bd/schema-processor-advanced-processors.spec.ts
npx playwright test tests/playwright/bd/schema-processor-final-integration.spec.ts
```

## Success Criteria

All PRDs are ready for execution when:

1. ✅ All pre-execution validation checks pass
2. ✅ All validation infrastructure scripts exist and work
3. ✅ All test files exist and are properly structured
4. ✅ All PRDs pass dev-loop PRD schema v1.2 validation
5. ✅ All validation gates have working implementations
6. ✅ All test specifications are executable
7. ✅ All dependencies are correctly specified
8. ✅ All documentation is complete

