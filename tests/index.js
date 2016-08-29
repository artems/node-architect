const path = require('path');
const Architect = require('../src/architect');

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

    app = new Architect(config);

    app
      .execute()
      .then(resolved => {
        assert.deepEqual(order, ['serviceB', 'serviceA']);
        assert.deepEqual(resolved, { serviceA: 'moduleA', serviceB: 'moduleB' });
      })
      .then(done, done);

  });

  it('should properly resolve async dependencies', function (done) {
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

    app = new Architect(config);

    app
      .execute()
      .then(resolved => {
        assert.deepEqual(resolved, {
          serviceA: 'moduleA',
          serviceB: 'moduleB',
          serviceC: 'moduleC',
          serviceD: 'moduleD'
        });
      })
      .then(done, done);

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

    app = new Architect(config);

    app
      .execute()
      .then(() => {})
      .then(done, done);

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

    app = new Architect(config);

    app
      .execute()
      .then(() => assert.fail('should fail'))
      .catch(e => {
        assert.instanceOf(e, Error);
        assert.match(e.message, /circular dependency detected/i);
      })
      .then(done, done);

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

    app = new Architect(config);

    app.execute()
      .then(() => assert.fail('should fail'))
      .catch(e => {
        assert.instanceOf(e, Error);
        assert.match(e.message, /dependency.*not found/i);
      })
      .then(done, done);
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

    app = new Architect(config);

    app
      .execute()
      .then(resolved => {
        assert.deepEqual(order, ['serviceA']);
        assert.deepEqual(resolved, { serviceA: 'moduleA' });
      })
      .then(done, done);

  });

  it('should reject promise if error occurs in service requiring', function (done) {
    config = {
      services: {
        serviceA: {
          path: 'path/not/exists'
        }
      }
    };

    app = new Architect(config);

    app
      .execute()
      .then(() => assert.fail('should fail'))
      .catch(e => {
        assert.instanceOf(e, Error);
        assert.match(e.message, /path\/not\/exists/i);
      })
      .then(done, done);

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

    app = new Architect(config);

    app
      .execute()
      .then(() => assert.fail('should fail'))
      .catch(e => {
        assert.instanceOf(e, Error);
        assert.match(e.message, /Error in serviceA/i);
      })
      .then(done, done);

  });

  it('should throw an error if startup of module timeouted', function (done) {
    config = {
      startup_timeout: 10,
      services: {
        serviceA: {
          module: function (i, o) {
            return new Promise(resolve => {
              setTimeout(() => { resolve('serviceA'); }, 20);
            });
          }
        }
      }
    };

    app = new Architect(config);
    app
      .execute()
      .then(() => assert.fail('should fail'))
      .catch(e => {
        assert.instanceOf(e, Error);
        assert.match(e.message, /timeout/i);
      })
      .then(done, done);
  });

  it('should not allow to execute an application twice', function () {
    app = new Architect();

    app.execute();

    assert.throws(
      app.execute.bind(app),
      /cannot execute the application twice/i
    );
  });

  describe('#values', function () {

    it('should return array of object values without keys', function () {
      const test = { a: 'aa', b: 'bb' };

      assert.deepEqual(Architect.values(test), ['aa', 'bb']);
    });

  });

  describe('#shutdown', function () {

    it('should support async shutdown', function (done) {
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

      app = new Architect(config);
      app
        .execute()
        .then(app.shutdown.bind(app))
        .then(() => assert(called))
        .then(done, done);

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

      app = new Architect(config);

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
        })
        .then(done, done);
    });

    it('should throw an error if app is not fully started', function () {
      app = new Architect({});

      try {
        app.shutdown();
        assert.fail('should fail');
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

      app = new Architect(config);
      app
        .execute()
        .then(app.shutdown.bind(app))
        .then(() => assert.fail('should fail'))
        .catch(e => {
          assert.instanceOf(e, Error);
          assert.match(e.message, /timeout/i);
        })
        .then(done, done);
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

      app = new Architect(config);

      app
        .execute()
        .then(() => assert.fail('should fail'))
        .catch(e => {
          assert.instanceOf(e, Error);
          assert.match(e.message, /is forbidden/i);
        })
        .then(done, done);
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

      app = new Architect(config);

      app
        .execute()
        .then(() => assert.fail('should fail'))
        .catch(e => {
          assert.instanceOf(e, Error);
          assert.match(e.message, /is forbidden/i);
        })
        .then(done, done);
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

      app = new Architect(config);

      app
        .execute()
        .then(() => assert.fail('should fail'))
        .catch(e => {
          assert.instanceOf(e, Error);
          assert.match(e.message, /is forbidden/i);
        })
        .then(done, done);
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

      app = new Architect(config);

      app
        .execute()
        .then(() => assert.fail('should fail'))
        .catch(e => {
          assert.instanceOf(e, Error);
          assert.match(e.message, /is forbidden/i);
        })
        .then(done, done);
    });

    it('#require should join path with `basePath`', function () {
      app = new Architect({}, path.join(__dirname, 'mocks'));

      assert.deepEqual(app.require('./test'), './mocks/test.js');
    });

    it('#require should not join path with `basePath` if path starts with `/`', function () {
      app = new Architect({}, path.join(__dirname, 'mocks'));
      const absolutePath = path.join(__dirname, 'mocks', 'test.js');

      assert.deepEqual(app.require(absolutePath), './mocks/test.js');
    });

    it('#requireDefault should return default export', function () {
      app = new Architect({}, path.join(__dirname, 'mocks'));

      assert.deepEqual(app.requireDefault('./test'), './mocks/test.js');
      assert.deepEqual(app.requireDefault('./es6.js'), './mocks/es6.js');
    });

  });

  describe('#addService', function () {

    it('should add service to startup config', function (done) {

      config = {
        services: {
          serviceA: {
            module: function (options, imports) {
              imports.__app__.addService('serviceB', {
                module: function () {
                  return 'moduleB';
                }
              });
              return 'moduleA';
            }
          }
        }
      };

      app = new Architect(config);

      app
        .execute()
        .then(resolved => {
          assert.deepEqual(resolved, { serviceA: 'moduleA', serviceB: 'moduleB' });
        })
        .then(done, done);

    });

    it('should throw an error if the service already exists', function (done) {

      config = {
        services: {
          serviceA: {
            module: function (options, imports) {
              imports.__app__.addService('serviceB', {
                module: function () {
                  return 'moduleB';
                }
              });
              return 'moduleA';
            }
          },
          serviceB: {
            module: function () { return 'moduleB' }
          }
        }
      };

      app = new Architect(config);
      app
        .execute()
        .then(() => assert.fail('should fail'))
        .catch(e => {
          assert.instanceOf(e, Error);
          assert.match(e.message, /exist/i);
        })
        .then(done, done);

    });

    it('should throw an error if the application fully started', function (done) {

      config = {
        services: {
          serviceA: {
            module: function (options, imports) {
              setTimeout(function () {
                try {
                  imports.__app__.addService('serviceB', {
                    module: function () {
                      return 'moduleB';
                    }
                  });
                  assert.fail('should fail');
                } catch (e) {
                  assert.match(e.message, /started/i);
                  done();
                }
              }, 0);
              return 'moduleA';
            }
          }
        }
      };

      app = new Architect(config);
      app.execute();

    });

  });

  describe('#addDependency', function () {

    it('should add dependency to service (array)', function (done) {

      config = {
        services: {
          serviceA: {
            module: function (options, imports) {
              imports.__app__.addDependency('serviceB', 'serviceC');
              return 'moduleA';
            }
          },
          serviceB: {
            module: function (options, imports) {
              assert.propertyVal(imports, 'serviceA', 'moduleA');
              assert.propertyVal(imports, 'serviceC', 'moduleC');
              return 'moduleB';
            },
            dependencies: ['serviceA']
          },
          serviceC: { module: function () { return 'moduleC'; } }
        }
      };

      app = new Architect(config);

      app
        .execute()
        .then(() => {})
        .then(done, done);

    });

    it('should add dependency to service (hash)', function (done) {

      config = {
        services: {
          serviceA: {
            module: function (options, imports) {
              imports.__app__.addDependency('serviceB', 'serviceC');
              return 'moduleA';
            }
          },
          serviceB: {
            module: function (options, imports) {
              assert.propertyVal(imports, 'serviceA', 'moduleA');
              assert.propertyVal(imports, 'serviceC', 'moduleC');
              return 'moduleB';
            },
            dependencies: { 'serviceA': 'serviceA' }
          },
          serviceC: { module: function () { return 'moduleC'; } }
        }
      };

      app = new Architect(config);

      app
        .execute()
        .then(() => {})
        .then(done, done);

    });

    it('should add dependency to service with alias', function (done) {

      config = {
        services: {
          serviceA: {
            module: function (options, imports) {
              imports.__app__.addDependency('serviceB', 'serviceC', 'serviceD');
              return 'moduleA';
            }
          },
          serviceB: {
            module: function (options, imports) {
              assert.propertyVal(imports, 'serviceA', 'moduleA');
              assert.propertyVal(imports, 'serviceD', 'moduleC');
              return 'moduleB';
            },
            dependencies: { 'serviceA': 'serviceA' }
          },
          serviceC: { module: function () { return 'moduleC'; } }
        }
      };

      app = new Architect(config);

      app
        .execute()
        .then(() => {})
        .then(done, done);

    });

    it('should throw an error if the service does not exist', function (done) {

      config = {
        services: {
          serviceA: {
            module: function (options, imports) {
              imports.__app__.addDependency('serviceB', 'serviceC');
              return 'moduleA';
            }
          }
        }
      };

      app = new Architect(config);

      app
        .execute()
        .then(() => assert.fail('should fail'))
        .catch(e => {
          assert.instanceOf(e, Error);
          assert.match(e.message, /exist/i);
        })
        .then(done, done);

    });

    it('should throw an error if the service has been started', function (done) {

      config = {
        services: {
          serviceA: {
            module: function (options, imports) {
              setTimeout(function () {
                try {
                  imports.__app__.addDependency('serviceB', 'serviceC');
                  assert.fail('should fail');
                } catch (e) {
                  assert.match(e.message, /started/i);
                  done();
                }
              }, 0);
              return 'moduleA';
            }
          },
          serviceB: {
            module: function () { return 'moduleB'; },
            dependencies: ['serviceA']
          },
          serviceC: { module: function () { return 'moduleC'; } }
        }
      };

      app = new Architect(config);

      app
        .execute()
        .then(() => {})
        .then(done, done);

    });

    it('should throw an error if the service has no dependencies', function (done) {

      config = {
        services: {
          serviceA: {
            module: function (options, imports) {
              imports.__app__.addDependency('serviceB', 'serviceC');
              return 'moduleA';
            }
          },
          serviceB: { module: function () { return 'moduleB'; } },
          serviceC: { module: function () { return 'moduleC'; } }
        }
      };

      app = new Architect(config);

      app
        .execute()
        .then(() => assert.fail('should fail'))
        .catch(e => {
          assert.instanceOf(e, Error);
          assert.match(e.message, /has no dependencies/i);
        })
        .then(done, done);

    });

  });

  describe('#setOption', function () {

    it('should add option for service', function (done) {

      config = {
        services: {
          serviceA: {
            module: function (options, imports) {
              imports.__app__.setOption('serviceB', 'a.b.c.d', 'e');
              return 'moduleA';
            }
          },
          serviceB: {
            module: function (options, imports) {
              assert.equal(options.a.b.c.d, 'e');
              return 'moduleB';
            },
            options: { a: { b: { c: { d: 'f' } } } },
            dependencies: ['serviceA']
          }
        }
      };

      app = new Architect(config);

      app
        .execute()
        .then(() => {})
        .then(done, done);

    });

    it('should add option for service even when service has no options', function (done) {

      config = {
        services: {
          serviceA: {
            module: function (options, imports) {
              imports.__app__.setOption('serviceB', 'a.b.c.d', 'e');
              return 'moduleA';
            }
          },
          serviceB: {
            module: function (options, imports) {
              assert.equal(options.a.b.c.d, 'e');
              return 'moduleB';
            },
            dependencies: ['serviceA']
          }
        }
      };

      app = new Architect(config);

      app
        .execute()
        .then(() => {})
        .then(done, done);

    });

  });

  describe('#addOptions', function () {

    it('should adds options for service', function (done) {

      config = {
        services: {
          serviceA: {
            module: function (options, imports) {
              imports.__app__.addOptions('serviceB', { a: 'b', c: 'd' });
              return 'moduleA';
            }
          },
          serviceB: {
            module: function (options, imports) {
              assert.equal(options.a, 'b');
              assert.equal(options.c, 'd');
              assert.equal(options.e, 'f');
              return 'moduleB';
            },
            options: { e: 'f' },
            dependencies: ['serviceA']
          }
        }
      };

      app = new Architect(config);

      app
        .execute()
        .then(() => {})
        .then(done, done);

    });

    it.only('should add options for service even when service has no options', function (done) {

      config = {
        services: {
          serviceA: {
            module: function (options, imports) {
              imports.__app__.addOptions('serviceB', { a: 'b' });
              return 'moduleA';
            }
          },
          serviceB: {
            module: function (options, imports) {
              assert.equal(options.a, 'b');
              return 'moduleB';
            },
            dependencies: ['serviceA']
          }
        }
      };

      app = new Architect(config);

      app
        .execute()
        .then(() => {})
        .then(done, done);

    });

  });

});
