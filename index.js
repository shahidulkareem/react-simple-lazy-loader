/**
 * 
 * 
 * Library File
 * 
 * 
 */

import invariant from 'invariant';
import { isEmpty, isFunction, isString, conformsTo, isObject } from 'lodash';

export const RESTART_ON_REMOUNT = '@@saga-injector/restart-on-remount';
export const DAEMON = '@@saga-injector/daemon';
export const ONCE_TILL_UNMOUNT = '@@saga-injector/once-till-unmount';

const allowedModes = [RESTART_ON_REMOUNT, DAEMON, ONCE_TILL_UNMOUNT];


/**
 * @param {object} store 
 * Validate the shape of redux store
 */
function checkStore(store) {
    const shape = {
        dispatch: isFunction,
        subscribe: isFunction,
        getState: isFunction,
        replaceReducer: isFunction,
        runSaga: isFunction,
        injectedReducers: isObject,
        injectedSagas: isObject,
    };
    invariant(
        conformsTo(store, shape),
        '(app/utils...) injectors: Expected a valid redux store',
    );
}


/**
 * 
 * @param {object} store 
 * @param {boolean} isValid 
 * @param {function} createReducer 
 * @returns 
 */
function injectReducerFactory(store, isValid, createReducer) {
    return function injectReducer(key, reducer) {
        if (!isValid) checkStore(store);

        invariant(
            isString(key) && !isEmpty(key) && isFunction(reducer),
            '(app/utils...) injectReducer: Expected `reducer` to be a reducer function',
        );

        // Check `store.injectedReducers[key] === reducer` for hot reloading when a key is the same but a reducer is different
        if (
            Reflect.has(store.injectedReducers, key) &&
            store.injectedReducers[key] === reducer
        )
            return;

        store.injectedReducers[key] = reducer; // eslint-disable-line no-param-reassign
        store.replaceReducer(createReducer(store.injectedReducers));
    };
}

/**
 * 
 * @param {object} store 
 * @param {function} reducers 
 * @returns 
 */
export function reducerInjectors(store, reducers) {
    checkStore(store);

    return {
        injectReducer: injectReducerFactory(store, true, reducers),
    };
}


/**
 * 
 * @param {string} key 
 * @returns 
 */
const checkKey = key =>
    invariant(
        isString(key) && !isEmpty(key),
        '(app/utils...) injectSaga: Expected `key` to be a non empty string',
    );


/**
 * 
 * @param {function} descriptor 
 */
const checkDescriptor = descriptor => {
    const shape = {
        saga: isFunction,
        mode: mode => isString(mode) && allowedModes.includes(mode),
    };
    invariant(
        conformsTo(descriptor, shape),
        '(app/utils...) injectSaga: Expected a valid saga descriptor',
    );
};


/**
 * 
 * @param {object} store 
 * @param {boolean} isValid 
 * @returns 
 */
function injectSagaFactory(store, isValid) {
    return function injectSaga(key, descriptor = {}, args) {
        if (!isValid) checkStore(store);

        const newDescriptor = {
            ...descriptor,
            mode: descriptor.mode || DAEMON,
        };
        const { saga, mode } = newDescriptor;

        checkKey(key);
        checkDescriptor(newDescriptor);

        let hasSaga = Reflect.has(store.injectedSagas, key);

        if (process.env.NODE_ENV !== 'production') {
            const oldDescriptor = store.injectedSagas[key];
            // enable hot reloading of daemon and once-till-unmount sagas
            if (hasSaga && oldDescriptor.saga !== saga) {
                oldDescriptor.task.cancel();
                hasSaga = false;
            }
        }

        if (
            !hasSaga ||
            (hasSaga && mode !== DAEMON && mode !== ONCE_TILL_UNMOUNT)
        ) {
            /* eslint-disable no-param-reassign */
            store.injectedSagas[key] = {
                ...newDescriptor,
                task: store.runSaga(saga, args),
            };
            /* eslint-enable no-param-reassign */
        }
    };
}

/**
 * 
 * @param {object} store 
 * @param {boolean} isValid 
 * @returns 
 */
function ejectSagaFactory(store, isValid) {
    return function ejectSaga(key) {
        if (!isValid) checkStore(store);

        checkKey(key);

        if (Reflect.has(store.injectedSagas, key)) {
            const descriptor = store.injectedSagas[key];
            if (descriptor.mode && descriptor.mode !== DAEMON) {
                descriptor.task.cancel();
                // Clean up in production; in development we need `descriptor.saga` for hot reloading
                if (process.env.NODE_ENV === 'production') {
                    // Need some value to be able to detect `ONCE_TILL_UNMOUNT` sagas in `injectSaga`
                    store.injectedSagas[key] = 'done'; // eslint-disable-line no-param-reassign
                }
            }
        }
    };
}

/**
 * 
 * @param {object} store 
 * @returns 
 */
export function sagaInjectors(store) {
    checkStore(store);

    return {
        injectSaga: injectSagaFactory(store, true),
        ejectSaga: ejectSagaFactory(store, true),
    };
}


/**
 * 
 * @param {object} param0 
 * @returns 
 */
function applyPromise({ injectReducer, injectSaga, container, require }) {

    const containerProvider = container;
    const [containerPromise, ...chunksPromise] = require || {};
    const promises = [containerPromise, ...chunksPromise];

    return Promise.all(promises).then(([promiseContainer, ...chunks]) => { // eslint-disable-line no-shadow
        chunks.forEach((chunk) => {

            const { name, reducer, saga } = chunk.default || chunk;

            if (reducer) {
                /**
                 * Injecting Reducer as Async Reducers
                 */
                injectReducer(name, reducer);
            }

            if (saga) {
                /**
                 * Injecting Saga
                 */
                injectSaga(name, { saga });
            }
        });


        try {
            const finalContainer = containerProvider.apply(promiseContainer.default, chunks.map((chunk) => chunk.default || chunk));
            return finalContainer
        } catch (error) {
            return error;
        }


    }).catch(error => {
        return error;
    });
}


/**
 * 
 * @param {function} injectReducer 
 * @param {function} injectSaga 
 * @param {function} applyPromise 
 * @returns 
 */
const routeProvider = (injectReducer, injectSaga, applyPromise) => ({ path, pageName, exact, require, container, childRoutes, data, ...props }) => ({
    path,
    pageName,
    exact,
    Component() {
      if (typeof container === 'function') {
        return applyPromise({ injectReducer, injectSaga, container, require });
      } else {
        return Promise.resolve((container)
          .then((defaultContainer) => defaultContainer.default)
          .catch(error => error));
      }
    },
    childRoutes,
    data,
    ...props
  });


/**
 * 
 * @param {object} store 
 * @param {function} reducers 
 * @returns 
 */  
export const simpleLazyLoadedRoute= (store, reducers) => {

    const { injectReducer } = reducerInjectors(store, reducers);
    const { injectSaga } = sagaInjectors(store);
    
    return routeProvider(injectReducer, injectSaga, applyPromise);   
}


export default simpleLazyLoadedRoute;

