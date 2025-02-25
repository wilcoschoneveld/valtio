import { getUntrackedObject } from 'proxy-compare'

const VERSION = Symbol()
const LISTENERS = Symbol()
const SNAPSHOT = Symbol()

const isObject = (x: unknown): x is object =>
  typeof x === 'object' && x !== null

let globalVersion = 0
const snapshotCache = new WeakMap<
  object,
  {
    version: number
    snapshot: unknown
  }
>()

export const proxy = <T extends object>(initialObject: T = {} as T): T => {
  let version = globalVersion
  const listeners = new Set<(nextVersion?: number) => void>()
  const notifyUpdate = (nextVersion?: number) => {
    if (!nextVersion) {
      nextVersion = ++globalVersion
    }
    if (version !== nextVersion) {
      version = nextVersion
      listeners.forEach((listener) => listener(nextVersion))
    }
  }
  const emptyCopy = Array.isArray(initialObject)
    ? []
    : Object.create(initialObject.constructor.prototype)
  const p = new Proxy(emptyCopy, {
    get(target, prop, receiver) {
      if (prop === VERSION) {
        return version
      }
      if (prop === LISTENERS) {
        return listeners
      }
      if (prop === SNAPSHOT) {
        const cache = snapshotCache.get(receiver)
        if (cache && cache.version === version) {
          return cache.snapshot
        }
        const snapshot = Object.create(target.constructor.prototype)
        snapshotCache.set(receiver, { version, snapshot })
        Reflect.ownKeys(target).forEach((key) => {
          const value = target[key]
          if (!isObject(value)) {
            snapshot[key] = value
          } else if (value instanceof Promise) {
            Object.defineProperty(snapshot, key, {
              get() {
                throw value
              },
            })
          } else {
            snapshot[key] = (value as any)[SNAPSHOT]
          }
        })
        return snapshot
      }
      return target[prop]
    },
    deleteProperty(target, prop) {
      const value = target[prop]
      const childListeners = isObject(value) && (value as any)[LISTENERS]
      if (childListeners) {
        childListeners.delete(notifyUpdate)
      }
      delete target[prop]
      notifyUpdate()
      return true
    },
    set(target, prop, value, receiver) {
      const childListeners = isObject(target[prop]) && target[prop][LISTENERS]
      if (childListeners) {
        childListeners.delete(notifyUpdate)
      }
      if (!isObject(value)) {
        target[prop] = value
      } else if (value instanceof Promise) {
        target[prop] = value.then((v) => {
          receiver[prop] = v
        })
      } else {
        value = getUntrackedObject(value) ?? value
        if (value[LISTENERS]) {
          target[prop] = value
        } else {
          target[prop] = proxy(value)
        }
        target[prop][LISTENERS].add(notifyUpdate)
      }
      notifyUpdate()
      return true
    },
  })
  Reflect.ownKeys(initialObject).forEach((key) => {
    p[key] = (initialObject as any)[key]
  })
  return p
}

export const getVersion = (p: any): number => p[VERSION]

export const subscribe = (p: any, callback: () => void) => {
  p[LISTENERS].add(callback)
  return () => {
    p[LISTENERS].delete(callback)
  }
}

export const snapshot = <T extends object>(p: T): T => (p as any)[SNAPSHOT]
