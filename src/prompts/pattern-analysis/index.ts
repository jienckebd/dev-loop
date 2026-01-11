export interface FrameworkPrompts {
  patternAnalysis: string;
  abstractionSuggestion: string;
  conventions: string[];
}

export const FRAMEWORK_PROMPTS: Record<string, FrameworkPrompts> = {
  drupal: {
    patternAnalysis: `Analyze these Drupal code patterns and identify opportunities for abstraction.

Consider:
- Plugin patterns (block, field formatter, field widget, etc.)
- Service patterns (dependency injection, service definitions)
- Config entity patterns (field storage, field config, entity type definitions)
- Hook implementations that could be plugins
- Form API patterns that could be abstracted
- Entity type and field definitions that follow similar patterns

Drupal-specific considerations:
- Use dependency injection for services
- Follow Drupal coding standards
- Use config entities for configuration
- Prefer plugins over hooks when possible
- Use third-party settings in field config for extensibility`,

    abstractionSuggestion: `Suggest Drupal-specific abstractions:

1. **Plugins**: For repeated plugin patterns (formatters, widgets, field types, etc.)
   - Create base plugin classes
   - Use plugin derivatives for variations
   - Consider plugin collections

2. **Config Schemas**: For repeated configuration structures
   - Define config schema types
   - Use config entities for complex config
   - Create config processors for transformation

3. **Entity Types**: For similar entity type definitions
   - Use base entity type configs
   - Create entity type templates
   - Consider entity type plugins

4. **Fields**: For repeated field configurations
   - Create field storage templates
   - Use third-party settings for extensions
   - Consider field type plugins

5. **Services**: For repeated service patterns
   - Extract to service classes
   - Use service decorators
   - Create service interfaces`,

    conventions: [
      'Use dependency injection for all services',
      'Follow Drupal coding standards (PSR-4, annotations)',
      'Use config entities for configuration, not variables',
      'Prefer plugins over hooks for extensibility',
      'Use third-party settings in field config for framework extensions',
      'Always clear caches after config changes',
    ],
  },

  django: {
    patternAnalysis: `Analyze these Django code patterns and identify opportunities for abstraction.

Consider:
- Serializer patterns (DRF serializers with similar fields)
- ViewSet patterns (CRUD operations, permissions, filters)
- Model patterns (similar field definitions, managers, methods)
- Service layer patterns (business logic that could be extracted)
- Form patterns (repeated validation, field definitions)
- Manager patterns (queryset methods, custom queries)

Django-specific considerations:
- Follow Django REST Framework conventions
- Use model managers for custom queries
- Prefer class-based views over function-based
- Extract business logic to service layer
- Use serializers for data transformation`,

    abstractionSuggestion: `Suggest Django-specific abstractions:

1. **Serializers**: For repeated serializer patterns
   - Create base serializer classes
   - Use serializer mixins
   - Create serializer fields for common patterns

2. **ViewSets**: For repeated CRUD patterns
   - Create base viewset classes
   - Use viewset mixins
   - Create custom actions as mixins

3. **Models**: For similar model definitions
   - Create abstract base models
   - Use model mixins
   - Create custom model managers

4. **Services**: For business logic patterns
   - Extract to service classes
   - Create service interfaces
   - Use dependency injection patterns

5. **Managers**: For repeated queryset patterns
   - Create custom manager classes
   - Use manager mixins
   - Create queryset methods`,

    conventions: [
      'Follow Django REST Framework conventions',
      'Use model managers for custom queries',
      'Prefer class-based views over function-based',
      'Extract business logic to service layer',
      'Use serializers for data transformation',
      'Follow PEP 8 coding standards',
    ],
  },

  react: {
    patternAnalysis: `Analyze these React code patterns and identify opportunities for abstraction.

Consider:
- Component patterns (similar props, state, lifecycle)
- Hook patterns (custom hooks that could be extracted)
- State management patterns (repeated useState, useContext)
- API call patterns (similar fetch/axios calls)
- Form patterns (repeated validation, field handling)
- Context patterns (similar context providers)

React-specific considerations:
- Prefer hooks over class components
- Use composition over inheritance
- Keep components pure and functional
- Extract custom hooks for reusable logic
- Use context for shared state`,

    abstractionSuggestion: `Suggest React-specific abstractions:

1. **Custom Hooks**: For repeated hook patterns
   - Extract to custom hooks
   - Create hook libraries
   - Use hook composition

2. **Components**: For similar component patterns
   - Create base component classes
   - Use higher-order components (HOCs)
   - Create component composition patterns

3. **Context Providers**: For repeated context patterns
   - Create reusable context providers
   - Use context composition
   - Create context hooks

4. **API Services**: For repeated API call patterns
   - Extract to service functions
   - Create API client classes
   - Use React Query or SWR patterns

5. **Utility Functions**: For repeated utility patterns
   - Extract to utility modules
   - Create utility libraries
   - Use functional composition`,

    conventions: [
      'Prefer hooks over classes',
      'Use composition over inheritance',
      'Keep components pure and functional',
      'Extract custom hooks for reusable logic',
      'Use context for shared state',
      'Follow React best practices and patterns',
    ],
  },

  'browser-extension': {
    patternAnalysis: `Analyze these browser extension patterns and identify opportunities for abstraction.

Consider:
- Message handler patterns (similar message passing logic)
- Content script patterns (repeated DOM manipulation, event handling)
- Background service patterns (similar event listeners, storage operations)
- Storage patterns (repeated localStorage/chrome.storage usage)
- API call patterns (similar fetch requests)
- Permission patterns (repeated permission checks)

Browser Extension-specific considerations:
- Use message passing for communication
- Handle cross-browser compatibility (Chrome, Firefox, Safari)
- Minimize permissions requested
- Use storage APIs efficiently
- Follow WebExtension API standards`,

    abstractionSuggestion: `Suggest Browser Extension-specific abstractions:

1. **Message Handlers**: For repeated message passing patterns
   - Create base message handler classes
   - Use message handler utilities
   - Create message type definitions

2. **Content Script Utilities**: For repeated DOM manipulation
   - Extract to utility functions
   - Create content script helpers
   - Use utility libraries

3. **Background Services**: For repeated background patterns
   - Extract to service classes
   - Create service utilities
   - Use service composition

4. **Storage Utilities**: For repeated storage operations
   - Create storage wrapper classes
   - Extract to storage utilities
   - Use storage abstraction layers

5. **API Clients**: For repeated API calls
   - Extract to API client classes
   - Create API utilities
   - Use fetch wrappers`,

    conventions: [
      'Use message passing for communication between contexts',
      'Handle cross-browser compatibility (Chrome, Firefox, Safari)',
      'Minimize permissions requested',
      'Use storage APIs efficiently',
      'Follow WebExtension API standards',
      'Use browser.* APIs when possible for cross-browser support',
    ],
  },
};
