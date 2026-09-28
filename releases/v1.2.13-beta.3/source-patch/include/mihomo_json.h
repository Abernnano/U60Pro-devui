/* Bounded JSON views for the controller API. No heap token tree, max depth 48.
 * String decoding is delegated to the renderer's existing Unicode decoder. */
#ifndef DEVUI_MH_JSON_H
#define DEVUI_MH_JSON_H
#include "json.h"
typedef struct { const char *p,*e; } mxj;
static const char *mx_ws(const char *p){while(*p && isspace((unsigned char)*p))p++;return p;}
static const char *mx_scan(const char *p,int depth)
{
    if(depth>48)return NULL;p=mx_ws(p);
    if(*p=='"'){for(p++;*p;p++){if(*p=='"')return p+1;if((unsigned char)*p<32)return NULL;
        if(*p=='\\'){p++;if(!*p)return NULL;if(*p=='u'){for(int i=0;i<4;i++)if(!isxdigit((unsigned char)*++p))return NULL;}
        else if(!strchr("\"\\/bfnrt",*p))return NULL;}}return NULL;}
    if(*p=='{' || *p=='['){char close=*p=='{'?'}':']';int obj=*p=='{';p=mx_ws(p+1);if(*p==close)return p+1;
        for(;;){if(obj){if(*p!='"'||!(p=mx_scan(p,depth+1)))return NULL;p=mx_ws(p);if(*p++!=':')return NULL;}
            if(!(p=mx_scan(p,depth+1)))return NULL;p=mx_ws(p);if(*p==close)return p+1;if(*p++!=',')return NULL;p=mx_ws(p);}}
    for(int i=0;i<3;i++){const char *s=(const char*[]){"true","false","null"}[i];size_t n=strlen(s);if(!strncmp(p,s,n))return p+n;}
    if(*p=='-')p++;if(*p=='0')p++;else{if(*p<'1'||*p>'9')return NULL;while(isdigit((unsigned char)*p))p++;}
    if(*p=='.'){p++;if(!isdigit((unsigned char)*p))return NULL;while(isdigit((unsigned char)*p))p++;}
    if(*p=='e'||*p=='E'){p++;if(*p=='+'||*p=='-')p++;if(!isdigit((unsigned char)*p))return NULL;while(isdigit((unsigned char)*p))p++;}return p;
}
static mxj mx_parse(const char *s){const char *p=mx_ws(s),*e=mx_scan(p,0);return (mxj){e&&!*mx_ws(e)?p:NULL,e};}
static int mx_text(mxj v,char *out,size_t cap)
{
    char tmp[4096];size_t n=v.p?(size_t)(v.e-v.p):0;
    if(n<2||*v.p!='"'||n+7>=sizeof tmp||n>=cap)return 0;
    memcpy(tmp,"{\"v\":",5);memcpy(tmp+5,v.p,n);memcpy(tmp+5+n,"}",2);
    if(!json_get(tmp,"v",out,cap))return 0;
    for(size_t i=0;out[i];i++)if((unsigned char)out[i]<32 || (unsigned char)out[i]==127)return 0;
    /* Reject encoded NUL instead of silently truncating an API name. */
    for(const char *p=v.p;p+5<v.e;p++)if(!strncmp(p,"\\u0000",6))return 0;
    return 1;
}
static mxj mx_field(mxj v,const char *key)
{
    if(!v.p||*v.p!='{')return (mxj){0};const char *p=mx_ws(v.p+1);char k[4096];
    while(p<v.e && *p!='}'){const char *e=mx_scan(p,0);if(!e)return (mxj){0};mxj name={p,e};p=mx_ws(e);if(*p++!=':')return (mxj){0};p=mx_ws(p);e=mx_scan(p,0);if(!e)return (mxj){0};
        if(mx_text(name,k,sizeof k)&&!strcmp(k,key))return (mxj){p,e};p=mx_ws(e);if(*p!=',')break;p=mx_ws(p+1);}return (mxj){0};
}
static mxj mx_at(mxj v,int index)
{
    if(!v.p||*v.p!='['||index<0)return (mxj){0};const char *p=mx_ws(v.p+1);
    while(p<v.e&&*p!=']'){const char *e=mx_scan(p,0);if(!e)return (mxj){0};if(!index--)return (mxj){p,e};p=mx_ws(e);if(*p!=',')break;p=mx_ws(p+1);}return (mxj){0};
}
static int mx_count(mxj v){int n=0;if(!v.p||*v.p!='[')return 0;const char *p=mx_ws(v.p+1);while(p<v.e&&*p!=']'){p=mx_scan(p,0);if(!p)return 0;n++;p=mx_ws(p);if(*p!=',')break;p=mx_ws(p+1);}return n;}
static mxj mx_group(mxj root,int index,char *name,size_t cap)
{
    mxj v=mx_field(root,"proxies");if(!v.p||*v.p!='{')return (mxj){0};const char *p=mx_ws(v.p+1);
    while(p<v.e&&*p!='}'){const char *e=mx_scan(p,0);if(!e)break;mxj k={p,e};p=mx_ws(e);if(*p++!=':')break;p=mx_ws(p);e=mx_scan(p,0);if(!e)break;mxj item={p,e};
        if(mx_field(item,"all").p && mx_text(k,name,cap)){if(!index--)return item;}
        p=mx_ws(e);if(*p!=',')break;p=mx_ws(p+1);}return (mxj){0};
}
#endif
