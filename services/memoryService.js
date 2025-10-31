const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

class MemoryService {
  constructor() {
    this.memoryProcess = null;
    this.client = null;
    this.isConnected = false;
    this.memoryFilePath = path.join(process.cwd(), 'memory.json');
  }

  /**
   * Initialize the memory service by starting the MCP server
   */
  async initialize() {
    const memoryFilePath = this.memoryFilePath;

    // Create MCP client transport with server parameters
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['@modelcontextprotocol/server-memory'],
      env: {
        ...process.env,
        MEMORY_FILE_PATH: memoryFilePath
      }
    });

    // Create and connect MCP client
    this.client = new Client(
      {
        name: 'twitch-ai-chatbot',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    try {
      await this.client.connect(transport);
      this.isConnected = true;
      console.log('Memory service connected successfully via MCP');
    } catch (error) {
      console.error('Failed to connect to memory service:', error);
      throw error;
    }
  }

  /**
   * Stop the memory service
   */
  async stopMemoryServer() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this.isConnected = false;
  }



  /**
   * Retrieve all relevant memory for a user using MCP tools
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} - Memory data
   */
  async retrieveMemory(userId = 'default_user') {
    if (!this.isConnected || !this.client) {
      throw new Error('Memory service not connected');
    }

    try {
      // Get the full graph using MCP tool
      const graphResult = await this.client.request(
        {
          method: 'tools/call',
          params: {
            name: 'read_graph',
            arguments: {}
          }
        },
        undefined
      );

      const graph = graphResult.content ? JSON.parse(graphResult.content[0].text) : { entities: [], relations: [] };

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
   * Create entities in memory using MCP tools
   * @param {Array} entities - Array of entity objects
   */
  async createEntities(entities) {
    if (!this.isConnected || !this.client) {
      throw new Error('Memory service not connected');
    }

    try {
      await this.client.request(
        {
          method: 'tools/call',
          params: {
            name: 'create_entities',
            arguments: {
              entities: entities
            }
          }
        },
        undefined
      );
      return entities; // MCP server handles filtering duplicates
    } catch (error) {
      console.error('Error creating entities:', error);
      throw error;
    }
  }

  /**
   * Create relations between entities using MCP tools
   * @param {Array} relations - Array of relation objects
   */
  async createRelations(relations) {
    if (!this.isConnected || !this.client) {
      throw new Error('Memory service not connected');
    }

    try {
      await this.client.request(
        {
          method: 'tools/call',
          params: {
            name: 'create_relations',
            arguments: {
              relations: relations
            }
          }
        },
        undefined
      );
      return relations; // MCP server handles filtering duplicates
    } catch (error) {
      console.error('Error creating relations:', error);
      throw error;
    }
  }

  /**
   * Add observations to entities using MCP tools
   * @param {Array} observations - Array of observation objects
   */
  async addObservations(observations) {
    if (!this.isConnected || !this.client) {
      throw new Error('Memory service not connected');
    }

    try {
      const result = await this.client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_observations',
            arguments: {
              observations: observations
            }
          }
        },
        undefined
      );
      return result.content ? JSON.parse(result.content[0].text) : [];
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
    const entities = [];
    const relations = [];
    const observations = [];

    // Create user entity if it doesn't exist
    if (newInfo.identity || newInfo.behaviors || newInfo.preferences || newInfo.goals) {
      entities.push({
        name: userId,
        entityType: 'person',
        observations: []
      });
    }

    // Add observations for different categories
    if (newInfo.identity && Array.isArray(newInfo.identity)) {
      observations.push({
        entityName: userId,
        contents: newInfo.identity
      });
    }

    if (newInfo.behaviors && Array.isArray(newInfo.behaviors)) {
      observations.push({
        entityName: userId,
        contents: newInfo.behaviors
      });
    }

    if (newInfo.preferences && Array.isArray(newInfo.preferences)) {
      observations.push({
        entityName: userId,
        contents: newInfo.preferences
      });
    }

    if (newInfo.goals && Array.isArray(newInfo.goals)) {
      observations.push({
        entityName: userId,
        contents: newInfo.goals
      });
    }

    // Handle relationships
    if (newInfo.relationships && Array.isArray(newInfo.relationships)) {
      newInfo.relationships.forEach(rel => {
        if (rel.entity && rel.relationType) {
          // Create the related entity
          entities.push({
            name: rel.entity,
            entityType: rel.entityType || 'person',
            observations: rel.observations || []
          });

          // Create the relation
          relations.push({
            from: userId,
            to: rel.entity,
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
