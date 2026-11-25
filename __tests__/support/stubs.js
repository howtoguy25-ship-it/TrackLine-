// Test stand-ins for whole modules (native services, Firebase-backed data, heavy sheets), so the
// real map screen can be rendered in Jest without a phone.
//
// - stubService(): every export is a function that does nothing and can be used either way the
//   app uses services -- called for an unsubscribe, awaited, or .then/.catch'ed.
// - stubComponents(): every export is a component that renders nothing (and accepts a ref).
const React = require("react");

function hybrid() {
  // A function that does nothing, whose every property is another such function, that also
  // behaves as an already-resolved promise.
  const target = function () {
    return hybrid();
  };
  return new Proxy(target, {
    get(t, key) {
      if (key === "then") {
        return (resolve) => {
          if (resolve) resolve(undefined);
          return hybrid();
        };
      }
      if (key === "catch") return () => hybrid();
      if (key === "finally") {
        return (cb) => {
          if (cb) cb();
          return hybrid();
        };
      }
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === Symbol.iterator) return undefined;
      if (key === "length" || key === "name" || key === "prototype") return t[key];
      return hybrid();
    },
  });
}

function stubService(overrides = {}) {
  return new Proxy(overrides, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "__esModule") return true;
      return hybrid();
    },
  });
}

const Null = React.forwardRef(function Null() {
  return null;
});

function stubComponents(overrides = {}) {
  return new Proxy(overrides, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "__esModule") return true;
      return Null;
    },
  });
}

module.exports = { stubService, stubComponents, Null };
