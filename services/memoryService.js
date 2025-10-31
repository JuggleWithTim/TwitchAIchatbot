const path = require('path');
const { promises: fs } = require('fs');

class MemoryService {
  constructor() {
    this.memoryFilePath = path.join(process.cwd(), 'memory.json');
    this.isInitialized = false;
  }

  /**
   * Initialize the memory service
   */
  async initialize() {
    this.isInitialized = true;
    console.log('Memory service initialized successfully');
  }

  /**
   * Stop the memory service
   */
  stopMemoryServer() {
    this.isInitialized = false;
  }

  /**
   * Load the knowledge graph from file
   */
  async loadGraph() {
    try {
      const data = await fs.readFile(this.memoryFilePath, 'utf-8');
      const lines = data.split('\n').filter(line => line.trim() !== '');
      return lines.reduce((graph, line) => {
        const item = JSON.parse(line);
        if (item.type === 'entity') graph.entities.push(item);
        if (item.type === 'relation') graph.relations.push(item);
        return graph;
      }, { entities: [], relations: [] });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { entities: [], relations: [] };
      }
      throw error;
    }
  }

  /**
   * Save the knowledge graph to file
   */
  async saveGraph(graph) {
    const lines = [
      ...graph.entities.map(e => JSON.stringify({
        type: 'entity',
        name: e.name,
        entityType: e.entityType,
        observations: e.observations
      })),
      ...graph.relations.map(r => JSON.stringify({
        type: 'relation',
        from: r.from,
        to: r.to,
        relationType: r.relationType
      })),
    ];
    await fs.writeFile(this.memoryFilePath, lines.join('\n'));
  }



  /**
   * Retrieve all relevant memory for a user
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} - Memory data
   */
  async retrieveMemory(userId = 'default_user') {
    if (!this.isInitialized) {
      throw new Error('Memory service not initialized');
    }

    try {
      const graph = await this.loadGraph();

      // Filter entities and relations related to the user
      const userEntities = graph.entities.filter(e =>
        e.name.toLowerCase().includes(userId.toLowerCase()) ||
        e.observations.some(o => o.toLowerCase().includes(userId.toLowerCase()))
      );

      const userEntityNames = new Set(userEntities.map(e => e.name));
      const userRelations = graph.relations.filter(r =>
        userEntityNames.has(r.from) || userEntityNames.has(r.to)
      );

      return {
        entities: userEntities,
        relations: userRelations,
        fullGraph: graph
      };
    } catch (error) {
      console.error('Error retrieving memory:', error);
      return { entities: [], relations: [], fullGraph: { entities: [], relations: [] } };
    }
  }

  /**
   * Create entities in memory
   * @param {Array} entities - Array of entity objects
   */
  async createEntities(entities) {
    if (!this.isInitialized) {
      throw new Error('Memory service not initialized');
    }

    try {
      const graph = await this.loadGraph();
      const newEntities = entities.filter(e =>
        !graph.entities.some(existingEntity => existingEntity.name === e.name)
      );
      graph.entities.push(...newEntities);
      await this.saveGraph(graph);
      return newEntities;
    } catch (error) {
      console.error('Error creating entities:', error);
      throw error;
    }
  }

  /**
   * Create relations between entities
   * @param {Array} relations - Array of relation objects
   */
  async createRelations(relations) {
    if (!this.isInitialized) {
      throw new Error('Memory service not initialized');
    }

    try {
      const graph = await this.loadGraph();
      const newRelations = relations.filter(r =>
        !graph.relations.some(existingRelation =>
          existingRelation.from === r.from &&
          existingRelation.to === r.to &&
          existingRelation.relationType === r.relationType
        )
      );
      graph.relations.push(...newRelations);
      await this.saveGraph(graph);
      return newRelations;
    } catch (error) {
      console.error('Error creating relations:', error);
      throw error;
    }
  }

  /**
   * Add observations to entities
   * @param {Array} observations - Array of observation objects
   */
  async addObservations(observations) {
    if (!this.isInitialized) {
      throw new Error('Memory service not initialized');
    }

    try {
      const graph = await this.loadGraph();
      const results = observations.map(o => {
        const entity = graph.entities.find(e => e.name === o.entityName);
        if (!entity) {
          throw new Error(`Entity with name ${o.entityName} not found`);
        }
        const newObservations = o.contents.filter(content =>
          !entity.observations.includes(content)
        );
        entity.observations.push(...newObservations);
        return { entityName: o.entityName, addedObservations: newObservations };
      });
      await this.saveGraph(graph);
      return results;
    } catch (error) {
      console.error('Error adding observations:', error);
      throw error;
    }
  }

  /**
   * Update memory with new information following the specified pattern
   * @param {string} userId - User identifier
   * @param {Object} newInfo - New information to store
   */
  async updateMemory(userId = 'default_user', newInfo) {
    // Normalize userId to lowercase (Twitch usernames are case-insensitive)
    const normalizedUserId = userId.toLowerCase();

    const entities = [];
    const relations = [];
    const observations = [];

    // Create user entity if it doesn't exist
    if (newInfo.identity || newInfo.behaviors || newInfo.preferences || newInfo.goals) {
      entities.push({
        name: normalizedUserId,
        entityType: 'person',
        observations: []
      });
    }

    // Add observations for different categories
    if (newInfo.identity && Array.isArray(newInfo.identity)) {
      observations.push({
        entityName: normalizedUserId,
        contents: newInfo.identity
      });
    }

    if (newInfo.behaviors && Array.isArray(newInfo.behaviors)) {
      observations.push({
        entityName: normalizedUserId,
        contents: newInfo.behaviors
      });
    }

    if (newInfo.preferences && Array.isArray(newInfo.preferences)) {
      observations.push({
        entityName: normalizedUserId,
        contents: newInfo.preferences
      });
    }

    if (newInfo.goals && Array.isArray(newInfo.goals)) {
      observations.push({
        entityName: normalizedUserId,
        contents: newInfo.goals
      });
    }

    // Handle relationships
    if (newInfo.relationships && Array.isArray(newInfo.relationships)) {
      newInfo.relationships.forEach(rel => {
        if (rel.entity && rel.relationType) {
          // Normalize entity name to lowercase (Twitch usernames are case-insensitive)
          const normalizedEntityName = rel.entity.toLowerCase();

          // Create the related entity
          entities.push({
            name: normalizedEntityName,
            entityType: rel.entityType || 'person',
            observations: rel.observations || []
          });

          // Create the relation
          relations.push({
            from: normalizedUserId,
            to: normalizedEntityName,
            relationType: rel.relationType
          });
        }
      });
    }

    // Execute the updates
    if (entities.length > 0) {
      await this.createEntities(entities);
    }

    if (relations.length > 0) {
      await this.createRelations(relations);
    }

    if (observations.length > 0) {
      await this.addObservations(observations);
    }
  }
}

module.exports = new MemoryService();
