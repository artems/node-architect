'use strict';

import path from 'path';
import Application from '../src/architect';

describe('architect', function () {

  let app, config;

  it('should properly resolve dependencies', function (done) {
    const order = [];

    config = {
      services: {
        serviceA: {
          module: function () {
            order.push('serviceA');
            return 'moduleA';
          },
          dependencies: ['serviceB']
        },
        serviceB: {
          module: function () {
            order.push('serviceB');
            return 'moduleB';
          }
        }
      }
    };

    app = new Application(config);

    app
      .execute()
      .then(resolved => {
        assert.deepEqual(order, ['serviceB', 'serviceA']);
        assert.deepEqual(resolved, { serviceA: 'moduleA', serviceB: 'moduleB' });
        done();
      })
      .catch(done);

  });

  it('should properly resolve async dependencies (callback)', function (done) {
    config = {
      services: {
        serviceA: {
          module: function (o, i, resolve) {
            setTimeout(() => { resolve('moduleA'); }, 10);
          },
          dependencies: ['serviceB', 'serviceC', 'serviceD']
        },
        serviceB: {
          module: function (o, i, resolve) {
            setTimeout(() => { resolve('moduleB'); }, 15);
          }
        },
        serviceC: {
          module: function (o, i, resolve) {
            setTimeout(() => { resolve('moduleC'); }, 20);
          }
        },
        serviceD: {
          module: function () {
            return 'moduleD';
          }
        }
      }
    };

    app = new Application(config);

    app
      .execute()
      .then(resolved => {
        assert.deepEqual(resolved, {
          serviceA: 'moduleA',
          serviceB: 'moduleB',
          serviceC: 'moduleC',
          serviceD: 'moduleD'
        });
        done();
      })
      .catch(done);

  });

  it('should properly resolve async dependencies (promise)', function (done) {
    config = {
      services: {
        serviceA: {
          module: function () {
            return new Promise(resolve => {
              setTimeout(() => { resolve('moduleA'); }, 10);
            });
          },
          dependencies: ['serviceB', 'serviceC', 'serviceD']
        },
        serviceB: {
          module: function () {
            return new Promise(resolve => {
              setTimeout(() => { resolve('moduleB'); }, 15);
            });
          }
        },
        serviceC: {
          module: function () {
            return new Promise(resolve => {
              setTimeout(() => { resolve('moduleC'); }, 20);
            });
          }
        },
        serviceD: {
          module: function () {
            return 'moduleD';
          }
        }
      }
    };

    app = new Application(config);

    app
      .execute()
      .then(resolved => {
        assert.deepEqual(resolved, {
          serviceA: 'moduleA',
          serviceB: 'moduleB',
          serviceC: 'moduleC',
          serviceD: 'moduleD'
        });
        done();
      })
      .catch(done);

  });


  it('should pass options and imports to service', function (done) {
    config = {
      services: {
        serviceA: {
          module: function (o, i) {
            assert.equal(o.A, 'A');
            assert.equal(o.B, 'B');
            assert.equal(i.serviceB, 'moduleB');

            return 'moduleA';
          },
          options: { A: 'A', B: 'B' },
          dependencies: ['serviceB']
        },
        serviceB: {
          module: function () {
            return 'moduleB';
          }
        }
      }
    };

    app = new Application(config);

    app
      .execute()
      .then(() => done());

  });

  it('should detect circular dependency', function (done) {
    config = {
      services: {
        serviceA: {
          module: function () {
            return 'moduleA';
          },
          dependencies: ['serviceB']
        },
        serviceB: {
          module: function () {
            return 'moduleB';
          },
          dependencies: ['serviceC']
        },
        serviceC: {
          module: function () {
            return 'moduleC';
          },
          dependencies: ['serviceA']
        }
      }
    };

    app = new Application(config);

    app
      .execute()
      .catch(e => {
        assert.instanceOf(e, Error);
        assert.match(e.message, /circular dependency detected/i);
        done();
      });

  });

  it('should throw an error if dependency was not found', function (done) {
    config = {
      services: {
        serviceA: {
          module: function () {
            return 'moduleA';
          },
          dependencies: ['serviceB']
        }
      }
    };

    app = new Application(config);

    app.execute()
      .catch(e => {
        assert.instanceOf(e, Error);
        assert.match(e.message, /dependency .* not found/i);
        done();
      });
  });

  it('should skip ignored services', function (done) {
    const order = [];

    config = {
      services: {
        serviceA: {
          module: function () {
            order.push('serviceA');
            return 'moduleA';
          }
        },
        serviceB: {
          ignore: true,
          module: function () {
            order.push('serviceB');
            return 'moduleB';
          }
        }
      }
    };

    app = new Application(config);

    app
      .execute()
      .then(resolved => {
        assert.deepEqual(order, ['serviceA']);
        assert.deepEqual(resolved, { serviceA: 'moduleA' });
        done();
      })
      .catch(done);

  });

  it('should reject promise if error occurs in service requiring', function (done) {
    config = {
      services: {
        serviceA: {
          path: 'path/not/exists'
        }
      }
    };

    app = new Application(config);

    app
      .execute()
      .catch(e => {
        assert.instanceOf(e, Error);
        assert.match(e.message, /path\/not\/exists/i);
        done();
      });

  });

  it('should reject promise if error occurs in service startup', function (done) {
    config = {
      services: {
        serviceA: {
          module: function () {
            throw new Error('Error in serviceA');
          }
        }
      }
    };

    app = new Application(config);

    app
      .execute()
      .catch(e => {
        assert.instanceOf(e, Error);
        assert.match(e.message, /Error in serviceA/i);
        done();
      });

  });

  it('should throw an error if startup of module timeouted', function (done) {
    config = {
      startup_timeout: 10,
      services: {
        serviceA: {
          module: function (i, o, resolve) {
            setTimeout(() => { resolve('serviceA'); }, 20);
          }
        }
      }
    };

    app = new Application(config);
    app
      .execute()
      .then(done)
      .catch(e => {
        assert.instanceOf(e, Error);
        assert.match(e.message, /timeout/i);
        done();
      });
  });

  it('should not allow to execute an application twice', function () {
    app = new Application();

    app.execute();

    assert.throws(
      app.execute.bind(app),
      /cannot execute the application twice/i
    );
  });

  describe('#values', function () {

    it('should return array of object values without keys', function () {
      const test = { a: 'aa', b: 'bb' };

      assert.deepEqual(Application.values(test), ['aa', 'bb']);
    });

  });

  describe('#shutdown', function () {

    it('should support async shutdown (promise)', function (done) {
      let called = false;

      config = {
        services: {
          serviceA: {
            module: function () {
              return {
                name: 'moduleA',
                shutdown: function () {
                  return new Promise(resolve => {
                    setTimeout(() => {
                      called = true;
                      resolve();
                    }, 20);
                  });
                }
              };
            }
          }
        }
      };

      app = new Application(config);
      app
        .execute()
        .then(app.shutdown.bind(app))
        .then(() => {
          assert(called);
          done();
        })
        .catch(done);

    });

  it('should support async shutdown (callback)', function (done) {
      let called = false;

      config = {
        services: {
          serviceA: {
            module: function () {
              return {
                name: 'moduleA',
                shutdown: function (resolve) {
                  setTimeout(() => {
                    called = true;
                    resolve();
                  }, 20);
                }
              };
            }
          }
        }
      };

      app = new Application(config);
      app
        .execute()
        .then(app.shutdown.bind(app))
        .then(() => {
          assert(called);
          done();
        })
        .catch(done);

    });

    it('should gracefuly shutdown services', function (done) {
      const order = [];

      config = {
        services: {
          serviceA: {
            module: function () {
              order.push('start serviceA');
              return Promise.resolve({
                name: 'moduleA',
                shutdown: function () {
                  order.push('shutdown serviceA');
                }
              });
            },
            dependencies: ['serviceB']
          },
          serviceB: {
            module: function () {
              order.push('start serviceB');
              return Promise.resolve({
                name: 'moduleB',
                shutdown: function () {
                  order.push('shutdown serviceB');
                }
              });
            }
          }
        }
      };

      app = new Application(config);

      app
        .execute()
        .then(app.shutdown.bind(app))
        .then(() => {
          assert.deepEqual(order, [
            'start serviceB',
            'start serviceA',
            'shutdown serviceB',
            'shutdown serviceA'
          ]);
          done();
        })
        .catch(done);
    });

    it('should throw an error if app is not fully started', function () {
      app = new Application({});

      try {
        app.shutdown();
        assert.fail('it should fail');
      } catch (e) {
        assert.instanceOf(e, Error);
        assert.match(e.message, /started/i);
      }
    });

    it('should throw an error if shutdown function timeouted', function (done) {
      config = {
        shutdown_timeout: 10,
        services: {
          serviceA: {
            module: function () {
              return Promise.resolve({
                name: 'moduleA',
                shutdown: function () {
                  return new Promise(resolve => {
                    setTimeout(() => { resolve('serviceA'); }, 20);
                  });
                }
              });
            }
          },
          serviceB: {
            module: function () {
              return 'serviceB';
            }
          }
        }
      };

      app = new Application(config);
      app
        .execute()
        .then(app.shutdown.bind(app))
        .catch(e => {
          assert.instanceOf(e, Error);
          assert.match(e.message, /timeout/i);
          done();
        });
    });

  });

  describe('require', function (done) {

    it('`require` is is forbidden service name', function () {
      config = {
        services: {
          require: {
            module: function () {
              return 'service';
            }
          }
        }
      };

      app = new Application(config);

      app
        .execute()
        .catch(e => {
          assert.instanceOf(e, Error);
          assert.match(e.message, /is forbidden/i);
          done();
        });
    });

    it('`requireDefault` is is forbidden service name', function () {
      config = {
        services: {
          requireDefault: {
            module: function () {
              return 'service';
            }
          }
        }
      };

      app = new Application(config);

      app
        .execute()
        .catch(e => {
          assert.instanceOf(e, Error);
          assert.match(e.message, /is forbidden/i);
          done();
        });
    });

    it('`require` is is forbidden alias', function () {
      config = {
        services: {
          serviceA: {
            module: function () {
              return 'serviceA';
            }
          },
          serviceB: {
            module: function () {
              return 'serviceB';
            },
            dependencies: { require: 'serviceA' }
          }
        }
      };

      app = new Application(config);

      app
        .execute()
        .catch(e => {
          assert.instanceOf(e, Error);
          assert.match(e.message, /is forbidden/i);
          done();
        });
    });

    it('`requireDefault` is is forbidden alias', function () {
      config = {
        services: {
          serviceA: {
            module: function () {
              return 'serviceA';
            }
          },
          serviceB: {
            module: function () {
              return 'serviceB';
            },
            dependencies: { requireDefault: 'serviceA' }
          }
        }
      };

      app = new Application(config);

      app
        .execute()
        .catch(e => {
          assert.instanceOf(e, Error);
          assert.match(e.message, /is forbidden/i);
          done();
        });
    });

    it('#require should join path with `basePath`', function () {
      app = new Application({}, path.join(__dirname, 'mocks'));

      assert.deepEqual(app.require('./test'), './mocks/test.js');
    });

    it('#require should not join path with `basePath` if path starts with `/`', function () {
      app = new Application({}, path.join(__dirname, 'mocks'));
      const absolutePath = path.join(__dirname, 'mocks', 'test.js');

      assert.deepEqual(app.require(absolutePath), './mocks/test.js');
    });

    it('#requireDefault should return default export', function () {
      app = new Application({}, path.join(__dirname, 'mocks'));

      assert.deepEqual(app.requireDefault('./test'), './mocks/test.js');
      assert.deepEqual(app.requireDefault('./es6.js'), './mocks/es6.js');
    });

  });

});
