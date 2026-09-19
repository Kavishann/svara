#import <Foundation/Foundation.h>
#import <NaturalLanguage/NaturalLanguage.h>
#include <node_api.h>

static napi_value identify(napi_env env, napi_callback_info info) {
    size_t argc = 1, length = 0; napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (argc != 1 || napi_get_value_string_utf8(env, argv[0], NULL, 0, &length) != napi_ok || length > 12000) {
        napi_throw_type_error(env, NULL, "Use a short text passage."); return NULL;
    }
    char *buffer = calloc(length + 1, 1);
    if (!buffer) { napi_throw_error(env, NULL, "Language detection is unavailable."); return NULL; }
    napi_get_value_string_utf8(env, argv[0], buffer, length + 1, &length);
    @autoreleasepool {
        NSString *text = [[NSString alloc] initWithBytes:buffer length:length encoding:NSUTF8StringEncoding];
        free(buffer);
        NLLanguageRecognizer *recognizer = [[NLLanguageRecognizer alloc] init];
        [recognizer processString:text ?: @""];
        NSString *language = recognizer.dominantLanguage ?: @"und";
        double confidence = [[recognizer languageHypothesesWithMaximum:1][language] doubleValue];
        napi_value result, name, probability;
        napi_create_object(env, &result);
        napi_create_string_utf8(env, language.UTF8String, NAPI_AUTO_LENGTH, &name);
        napi_create_double(env, confidence, &probability);
        napi_set_named_property(env, result, "language", name);
        napi_set_named_property(env, result, "confidence", probability);
        return result;
    }
}
static napi_value init(napi_env env, napi_value exports) {
    napi_property_descriptor property = { "identify", NULL, identify, NULL, NULL, NULL, napi_default, NULL };
    napi_define_properties(env, exports, 1, &property); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
