#include <Carbon/Carbon.h>
#include <node_api.h>
#include <stdbool.h>
#include <stdlib.h>

typedef struct {
    EventHandlerRef handler;
    napi_threadsafe_function callback;
    EventHotKeyID pressed, watched;
    bool handling_press, armed;
    uint32_t token;
} ReleaseContext;

static void call_js(napi_env env, napi_value callback, void *context, void *data) {
    (void)context;
    uint32_t token = *(uint32_t *)data;
    free(data);
    if (!env || !callback) return;
    napi_value argument, receiver, result;
    napi_create_uint32(env, token, &argument);
    napi_get_undefined(env, &receiver);
    napi_call_function(env, receiver, callback, 1, &argument, &result);
}

static OSStatus hotkey_event(EventHandlerCallRef next, EventRef event, void *data) {
    ReleaseContext *ctx = data;
    EventHotKeyID id;
    if (GetEventParameter(event, kEventParamDirectObject, typeEventHotKeyID,
        NULL, sizeof(id), NULL, &id) != noErr) return eventNotHandledErr;
    if (GetEventKind(event) == kEventHotKeyPressed) {
        // Electron dispatches its normal callback, which synchronously calls
        // arm() to capture this exact shortcut ID, including keyboard layout.
        EventHotKeyID previous = ctx->pressed;
        bool was_handling = ctx->handling_press;
        ctx->pressed = id; ctx->handling_press = true;
        OSStatus result = CallNextEventHandler(next, event);
        ctx->pressed = previous; ctx->handling_press = was_handling;
        return result;
    }
    if (ctx->armed && id.id == ctx->watched.id && id.signature == ctx->watched.signature) {
        ctx->armed = false;
        uint32_t *token = malloc(sizeof(*token));
        if (token) {
            *token = ctx->token;
            if (napi_call_threadsafe_function(ctx->callback, token, napi_tsfn_nonblocking) != napi_ok) free(token);
        }
        return noErr;
    }
    return eventNotHandledErr;
}

static OSStatus refresh_handler(ReleaseContext *ctx) {
    if (ctx->handler) { RemoveEventHandler(ctx->handler); ctx->handler = NULL; }
    EventTypeSpec events[] = {
        { kEventClassKeyboard, kEventHotKeyPressed },
        { kEventClassKeyboard, kEventHotKeyReleased }
    };
    return InstallApplicationEventHandler(hotkey_event, 2, events, ctx, &ctx->handler);
}

static ReleaseContext *arguments(napi_env env, napi_callback_info info, size_t *argc, napi_value *argv) {
    void *data = NULL;
    napi_get_cb_info(env, info, argc, argv, NULL, &data);
    return data;
}
static napi_value nothing(napi_env env) { napi_value value; napi_get_undefined(env, &value); return value; }
static napi_value failure(napi_env env, const char *message) { napi_throw_error(env, NULL, message); return NULL; }

static napi_value initialize(napi_env env, napi_callback_info info) {
    size_t argc = 1; napi_value argv[1], name; napi_valuetype type;
    ReleaseContext *ctx = arguments(env, info, &argc, argv);
    if (ctx->callback || argc != 1 || napi_typeof(env, argv[0], &type) != napi_ok || type != napi_function)
        return failure(env, "The shortcut release listener could not start.");
    napi_create_string_utf8(env, "Svara shortcut release", NAPI_AUTO_LENGTH, &name);
    if (napi_create_threadsafe_function(env, argv[0], NULL, name, 0, 1, NULL, NULL, NULL, call_js, &ctx->callback) != napi_ok)
        return failure(env, "The shortcut release listener could not start.");
    napi_unref_threadsafe_function(env, ctx->callback);
    return nothing(env);
}
static napi_value refresh(napi_env env, napi_callback_info info) {
    size_t argc = 0; ReleaseContext *ctx = arguments(env, info, &argc, NULL);
    if (!ctx->callback || refresh_handler(ctx) != noErr) return failure(env, "Mac shortcut release events are unavailable. Restart Svara.");
    return nothing(env);
}
static napi_value arm(napi_env env, napi_callback_info info) {
    size_t argc = 0; ReleaseContext *ctx = arguments(env, info, &argc, NULL);
    if (!ctx->handling_press || !ctx->callback) return failure(env, "The speaking shortcut did not provide a Mac key-press event. Restart Svara.");
    ctx->watched = ctx->pressed; ctx->armed = true;
    if (++ctx->token == 0) ++ctx->token;
    napi_value token; napi_create_uint32(env, ctx->token, &token); return token;
}
static napi_value cancel_watch(napi_env env, napi_callback_info info) {
    size_t argc = 1; napi_value argv[1]; uint32_t token;
    ReleaseContext *ctx = arguments(env, info, &argc, argv);
    if (argc == 1 && napi_get_value_uint32(env, argv[0], &token) == napi_ok && token == ctx->token) ctx->armed = false;
    return nothing(env);
}
static void dispose(ReleaseContext *ctx) {
    ctx->armed = false;
    if (ctx->handler) { RemoveEventHandler(ctx->handler); ctx->handler = NULL; }
    if (ctx->callback) { napi_release_threadsafe_function(ctx->callback, napi_tsfn_abort); ctx->callback = NULL; }
}
static napi_value close_listener(napi_env env, napi_callback_info info) {
    size_t argc = 0; ReleaseContext *ctx = arguments(env, info, &argc, NULL);
    dispose(ctx); return nothing(env);
}
static void cleanup(void *data) { ReleaseContext *ctx = data; dispose(ctx); free(ctx); }

#ifdef SVARA_NATIVE_TEST
// Test-only events stay in this process; no keyboard input is posted to macOS.
typedef struct { napi_env env; napi_value callback; } TestContext;
static OSStatus test_handler(EventHandlerCallRef next, EventRef event, void *data) {
    (void)next; (void)event;
    TestContext *test = data; napi_value receiver, result;
    napi_get_undefined(test->env, &receiver);
    napi_call_function(test->env, receiver, test->callback, 0, NULL, &result);
    return noErr;
}
static napi_value test_deliver(napi_env env, napi_callback_info info) {
    size_t argc = 3; napi_value argv[3]; uint32_t kind = 0, id = 0;
    ReleaseContext *ctx = arguments(env, info, &argc, argv);
    if (argc < 2 || napi_get_value_uint32(env, argv[0], &kind) != napi_ok || napi_get_value_uint32(env, argv[1], &id) != napi_ok)
        return failure(env, "Invalid native test event");
    EventHandlerRef handler = NULL; TestContext test = { env, argc == 3 ? argv[2] : NULL };
    if (kind == kEventHotKeyPressed) {
        EventTypeSpec pressed = { kEventClassKeyboard, kEventHotKeyPressed };
        if (!test.callback || InstallApplicationEventHandler(test_handler, 1, &pressed, &test, &handler) != noErr)
            return failure(env, "Native test handler failed");
    }
    refresh_handler(ctx);
    EventRef event;
    CreateEvent(NULL, kEventClassKeyboard, kind, 0, kEventAttributeNone, &event);
    EventHotKeyID hotkey = { 0x53565254, id };
    SetEventParameter(event, kEventParamDirectObject, typeEventHotKeyID, sizeof(hotkey), &hotkey);
    SendEventToEventTarget(event, GetApplicationEventTarget());
    ReleaseEvent(event);
    if (handler) RemoveEventHandler(handler);
    return nothing(env);
}
#endif

static napi_value init(napi_env env, napi_value exports) {
    ReleaseContext *ctx = calloc(1, sizeof(*ctx));
    if (!ctx) return failure(env, "Unable to initialize shortcut release events.");
    napi_property_descriptor properties[] = {
        { "initialize", NULL, initialize, NULL, NULL, NULL, napi_default, ctx },
        { "refresh", NULL, refresh, NULL, NULL, NULL, napi_default, ctx },
        { "arm", NULL, arm, NULL, NULL, NULL, napi_default, ctx },
        { "cancel", NULL, cancel_watch, NULL, NULL, NULL, napi_default, ctx },
        { "close", NULL, close_listener, NULL, NULL, NULL, napi_default, ctx },
#ifdef SVARA_NATIVE_TEST
        { "testDeliver", NULL, test_deliver, NULL, NULL, NULL, napi_default, ctx },
#endif
    };
    napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
    napi_add_env_cleanup_hook(env, cleanup, ctx);
    return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
