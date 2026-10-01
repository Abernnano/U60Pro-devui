/* Strict legacy daily/monthly counters; missing counters are never fabricated. */
#ifndef U60_TRAFFIC_STATS_H
#define U60_TRAFFIC_STATS_H
#include "json.h"
#include <stdint.h>
#include <errno.h>
#include <stdlib.h>
#include <ctype.h>
#include <string.h>
static inline int traffic_counter(const char *json, const char *key, uint64_t *out)
{
    char s[64], *end;
    if (!json_get(json,key,s,sizeof s) || !s[0]) return 0;
    for (const char *p=s; *p; ++p) if (!isdigit((unsigned char)*p)) return 0;
    errno=0; unsigned long long value=strtoull(s,&end,10);
    if (errno || *end) return 0;
    *out=(uint64_t)value; return 1;
}
static inline unsigned traffic_legacy_parse(const char *json, uint64_t values[4])
{
    static const char *keys[]={"day_rx_bytes","day_tx_bytes","month_rx_bytes","month_tx_bytes"};
    unsigned mask=0;
    memset(values,0,4*sizeof(*values));
    for (int i=0;i<4;i++) if (traffic_counter(json,keys[i],&values[i])) mask|=1u<<i;
    return mask;
}
static inline unsigned traffic_history_parse(const char *snapshot, const char *traffic, uint64_t values[4])
{
    uint64_t top[4]; unsigned top_mask=traffic_legacy_parse(snapshot,top);
    unsigned mask=traffic_legacy_parse(traffic ? traffic : "{}",values);
    for (int i=0;i<4;i++) if (!(mask&(1u<<i)) && (top_mask&(1u<<i))) {
        values[i]=top[i]; mask|=1u<<i;
    }
    return mask;
}
static inline uint64_t traffic_sum(uint64_t a,uint64_t b) { return UINT64_MAX-a<b ? UINT64_MAX : a+b; }
#endif
