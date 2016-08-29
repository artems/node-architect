const path = require('path');
const oset = require('object-set');
const omerge = require('object-merge');

const DEFAULT_STARTUP_TIMEOUT = 5000;
const DEFAULT_SHUTDOWN_TIMEOUT = 5000;

function values(object) {
  return Object.keys(object).map(key => object[key]);
}

function makeDictionary(array) {
  const newObject = {};
  array.forEach(name => newObject[name] = name);
  return newObject;
}

class Architect {

  /**
   * @constructor
   *
   * @param {Object} config - application config.
   * @param {String} [basePath] - the path relative to which all modules are located.
   */
  constructor(config, basePath) {
    config = config || {};

    this.config = config;

    this.services = config.services || {};
    this.startupTimeout = config.startup_timeout || DEFAULT_STARTUP_TIMEOUT;
    this.shutdownTimeout = config.shutdown_timeout || DEFAULT_SHUTDOWN_TIMEOUT;

    this.ignored = {};
    this.starting = {};
    this.resolved = {};
    this.teardown = {};

    this.promise = null;
    this.started = false;
    this.executed = false;
    this.basePath = basePath || '.';
    this.awaiting = Object.keys(this.services);

    this._require = this.require.bind(this);
    this._requireDefault = this.requireDefault.bind(this);
  }

  require(modulePath) {
    const realPath = modulePath[0] === '/'
      ? modulePath
      : path.join(this.basePath, modulePath);

    return require(realPath);
  }

  requireDefault(modulePath) {
    const module = this.require(modulePath);

    if (module.__esModule && module['default']) {
      return module['default'];
    }

    return module;
  }

  /**
   * Add service to startup config.
   *
   * @param {String} name - service name
   * @param {String} spec - service specification
   */
  addService(name, spec) {
    if (name in this.services) {
      throw new Error('Cannot add service `' + name + '`. The service already exists.');
    }

    if (this.started) {
      throw new Error('Cannot add service `' + name + '` after the application fully started.');
    }

    this.services[name] = spec;
    this.awaiting.push(name);
  }

  /**
   * Add new dependency to service.
   *
   * @param {String} name - service name
   * @param {String} dependency - dependency name
   * @param {String} [alias] - alternative dependency name
   */
  addDependency(name, dependency, alias) {
    if (!(name in this.services)) {
      throw new Error('Cannot add dependency for `' + name + '`. The service does not exist.');
    }

    if (this.starting[name]) {
      throw new Error('Cannot add dependency for `' + name + '`. The service has been started.');
    }

    if (!this.services[name].dependencies) {
      throw new Error('Cannot add dependency for `' + name + '`. The service has no dependencies.');
    }

    if (alias && Array.isArray(this.services[name].dependencies)) {
      this.services[name].dependencies =
        makeDictionary(this.services[name].dependencies);
    }

    if (Array.isArray(this.services[name].dependencies)) {
      this.services[name].dependencies.push(dependency);
    } else {
      this.services[name].dependencies[alias || dependency] = dependency;
    }
  }

  /**
   * Set option for service.
   *
   * @param {String} name - service name
   * @param {String} key - option key or path (a.b.c.d)
   * @param {*} value - option value
   */
  setOption(name, key, value) {
    if (!(name in this.services)) {
      throw new Error('Cannot set option for `' + name + '`. The service does not exist.');
    }

    if (!this.services[name].options) {
      this.services[name].options = {};
    }

    oset(this.services[name].options, key, value);
  }

  /**
   * Adds options for service.
   *
   * @param {String} name - service name
   * @param {Object} options
   */
  addOptions(name, options) {
    if (!(name in this.services)) {
      throw new Error('Cannot add options for `' + name + '`. The service does not exist.');
    }

    this.services[name].options = omerge(this.services[name].options, options);
  }

  /**
   * Returns config.
   *
   * @return {Object}
   */
  getConfig() {
    return this.config;
  }

  /**
   * Run an application.
   *
   * @return {Promise}
   */
  execute() {
    if (this.executed) {
      throw new Error('Cannot execute the application twice.');
    }

    try {
      this.checkConstraints();
    } catch (e) {
      return Promise.reject(e);
    }

    this.fillIgnored();
    this.cleanAwaiting();

    return new Promise((resolve, reject) => {
      this.promise = { resolve, reject };
      this.executed = true;
      this.nextRound();
    });
  }

  /**
   * Graceful shutdown an application.
   *
   * @return {Promise}
   */
  shutdown() {
    const promise = [];

    if (!this.started) {
      throw new Error('The application cannot gracefully shutdown until fully started.');
    }

    for (const name in this.teardown) {
      promise.push(this.teardown[name]());
    }

    return new Promise((resolve, reject) => {
      const shutdownTimer = setTimeout(() => {
        reject(new Error('Timeout of shutdown is exceeded'));
      }, this.shutdownTimeout);

      Promise
        .all(promise)
        .then(() => {
          clearTimeout(shutdownTimer);
          resolve();
        })
        .catch(error => {
          clearTimeout(shutdownTimer);
          reject(error);
        });
    });
  }

  /**
   * Launching a new round.
   * Each round method checks which of services can be started.
   * Throw deadlock exception when there are no starting services
   * and no one of services started in the last round.
   *
   * @private
   */
  nextRound() {
    let startedInThisRound = 0;

    for (let i = 0; i < this.awaiting.length; i++) {
      const name = this.awaiting[i];
      const service = this.services[name];

      if (this.checkDependencies(name, service)) {
        this.startService(name, service);
        startedInThisRound++;
      }
    }

    if (this.awaiting.length === 0 && Object.keys(this.starting).length === 0) {
      this.started = true;
      this.promise.resolve(this.resolved);
      return;
    }

    if (startedInThisRound === 0) {
      if (Object.keys(this.starting).length === 0) {
        this.promise.reject(new Error(
          'Circular dependency detected while resolving ' +
          this.awaiting.join(', ')
        ));
      }
    }
  }

  fillIgnored() {
    for (let i = 0; i < this.awaiting.length; i++) {
      const name = this.awaiting[i];
      const service = this.services[name];

      if (service.ignore) {
        this.ignored[name] = 1;
      }
    }
  }

  cleanAwaiting() {
    Object.keys(this.ignored).forEach(name => {
      this.awaiting.splice(this.awaiting.indexOf(name), 1);
    });
  }

  /**
   * Check dependencies of a given service.
   * Returns `true` when all dependencies are resolved and `false` otherwise.
   *
   * @private
   *
   * @param {String} name - service name
   * @param {Object} service - service object
   *
   * @return {Boolean}
   */
  checkDependencies(name, service) {
    if (!service.dependencies || service.dependencies.length === 0) {
      return true;
    }

    let resolved = true;

    this.getDependencyNames(service).forEach(dependency => {
      if (!(dependency in this.resolved)) {
        resolved = false;
      }

      if (dependency in this.ignored) {
        this.promise.reject(new Error(
          'Dependency `' + dependency + '` on `' + name + '` is ignored'
        ));
      }

      if (!(dependency in this.services)) {
        this.promise.reject(new Error(
          'Dependency `' + dependency + '` on `' + name + '` was not found'
        ));
      }
    });

    return resolved;
  }

  checkConstraints() {
    this.checkNameConstraints(this.awaiting);

    this.awaiting.forEach(name => {
      const service = this.services[name];
      const dependencies = this.getDependencyNames(service);

      this.checkNameConstraints(dependencies);
    });
  }

  checkNameConstraints(dependencies) {
    dependencies.forEach(name => {
      if (name === 'require') {
        throw new Error('Service name `require` is forbidden.');
      }

      if (name === 'requireDefault') {
        throw new Error('Service name `requireDefault` is forbidden.');
      }
    });
  }

  getDependencyNames(service) {
    if (!service.dependencies) {
      return [];
    }

    return Array.isArray(service.dependencies)
        ? service.dependencies
        : values(service.dependencies);
  }

  obtainModule(name, service) {
    let serviceModule;

    try {
      serviceModule = service.module || this.requireDefault(service.path);
    } catch (error) {
      this.promise.reject(new Error(
        'Error occurs during module requiring (' + name + ').\n' + error.stack
      ));
    }

    return serviceModule;
  }

  obtainDepenedcies(name, service) {
    const imports = { __app__: this };

    if (!service.dependencies) {
      return imports;
    }

    if (Array.isArray(service.dependencies)) {
      service.dependencies.forEach(name => {
        imports[name] = this.resolved[name];
      });
    } else {
      Object.keys(service.dependencies).forEach(alias => {
        const name = service.dependencies[alias];
        imports[alias] = this.resolved[name];
      });
    }

    return imports;
  }

  /**
   * Start a given service.
   *
   * @private
   *
   * @param {String} name - service name
   * @param {Object} service - service object
   */
  startService(name, service) {
    const options = service.options || {};
    const imports = this.obtainDepenedcies(name, service);
    const serviceModule = this.obtainModule(name, service);

    if (!serviceModule) return;

    this.starting[name] = true;
    this.awaiting.splice(this.awaiting.indexOf(name), 1);

    try {
      const startupTimer = setTimeout(() => {
        this.promise.reject(new Error(
          'Timeout of startup module `' + name + '` is exceeded'
        ));
      }, this.startupTimeout);

      const module = serviceModule(options, imports);
      this.register(name, startupTimer, module);
    } catch (error) {
      this.promise.reject(new Error(
        'Error occurs during module `' + name + '` startup.\n' + error.stack
      ));
    }
  }

  register(name, timer, module) {
      // the module may be "promise" or just "plain object".
      Promise.resolve(module)
        .then(service => {
          service = service || {};

          clearTimeout(timer);
          delete this.starting[name];

          this.resolved[name] = service;
          this.teardown[name] = service.shutdown || function () {}

          this.nextRound();
        })
        .catch(error => {
          this.promise.reject(new Error(
            'Error occurs during module `' + name + '` startup.\n' + error.stack
          ));
        })
  }

}

module.exports = Architect;
module.exports.values = values;
module.exports.makeDictionary = makeDictionary;
