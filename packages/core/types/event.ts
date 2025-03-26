const SOURCE = {
  CORE: 'core-service',
  GENERAL: 'general',
};

export type EventDetail = {
  Source: string;
  DetailType: string;
};

const EVENT = {
  CORE: {
    LOGIN_EMAIL_REQUESTED: {
      Source: SOURCE.CORE,
      DetailType: 'login-email-requested',
    },

    /*
     * Entity
     */
    ENTITY_CREATED: {
      Source: SOURCE.CORE,
      DetailType: 'entity-created',
    },
    ENTITY_UPSERTED: {
      Source: SOURCE.CORE,
      DetailType: 'entity-upserted',
    },
    ENTITY_UPDATED: {
      Source: SOURCE.CORE,
      DetailType: 'entity-updated',
    },
    ENTITY_DELETED: {
      Source: SOURCE.CORE,
      DetailType: 'entity-deleted',
    },
    ENTITY_MUTUAL_TO_CREATE: {
      Source: SOURCE.CORE,
      DetailType: 'entity-mutual-to-create',
    },
    ENTITY_MUTUAL_TO_UPDATE: {
      Source: SOURCE.CORE,
      DetailType: 'entity-mutual-to-update',
    },
    ENTITY_MUTUAL_PROCESSED: {
      Source: SOURCE.CORE,
      DetailType: 'entity-mutual-processed',
    },

    CREATE_ENTITY: {
      Source: SOURCE.CORE,
      DetailType: 'create-entity',
    },

    /*
     * Mutual
     */
    MUTUAL_CREATED: (byEntityType: string, entityType: string) => ({
      Source: SOURCE.CORE,
      DetailType: `mutual-created:${byEntityType}:${entityType}`,
    }),
    MUTUAL_UPDATED: (byEntityType: string, entityType: string) => ({
      Source: SOURCE.CORE,
      DetailType: `mutual-updated:${byEntityType}:${entityType}`,
    }),
    MUTUAL_DELETED: (byEntityType: string, entityType: string) => ({
      Source: SOURCE.CORE,
      DetailType: `mutual-deleted:${byEntityType}:${entityType}`,
    }),
    PREJOIN_RELATIONSHIP_SYNC: {
      Source: SOURCE.CORE,
      DetailType: 'prejoin-relationship-sync',
    },
  },

  GENERAL: {
    ENDPOINT_ERROR: {
      Source: SOURCE.GENERAL,
      DetailType: 'endpoint-error',
    },
  },
};

export { SOURCE, EVENT };
