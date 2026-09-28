/* Battery-monitor configuration bridge. No additional charging daemon.
 * Bounded JSON validation, preservation of unknown keys, atomic replacement.
 * SPDX-License-Identifier: MIT */
#ifndef U60_BATTERY_CONFIG_H
#define U60_BATTERY_CONFIG_H
#include "json.h"
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
#define BP_CAP 16384
struct bp_config { int limit, recover, protect, automatic, manual; };
struct bp_field { const char *key; size_t start, end; int seen; };
static const char *bp_keys[] = {"charge_val", "charge_recover", "charge_limit", "auto_bypass", "bypass_power"};
static void bp_ws(const char **p) { while (**p && strchr(" \r\n\t", **p)) ++*p; }
static int bp_string(const char **p)
{
    if (*(*p)++ != '"') return 0;
    while (**p && **p != '"') {
        unsigned char c = (unsigned char)*(*p)++;
        if (c < 32) return 0;
        if (c == '\\') {
            c = (unsigned char)*(*p)++;
            if (!c) return 0;
            if (c == 'u') { for (int i=0;i<4;i++) { if (!isxdigit((unsigned char)**p)) return 0; ++*p; } }
            else if (!strchr("\"\\/bfnrt", c)) return 0;
        }
    }
    if (**p != '"') return 0;
    ++*p; return 1;
}
static int bp_value(const char **p, int depth)
{
    if (depth > 16) return 0;
    bp_ws(p);
    if (**p == '"') return bp_string(p);
    if (**p == '{' || **p == '[') {
        int object = **p == '{'; char close = object ? '}' : ']'; ++*p; bp_ws(p);
        if (**p == close) { ++*p; return 1; }
        for (;;) {
            if (object) { if (**p != '"' || !bp_string(p)) return 0; bp_ws(p); if (*(*p)++ != ':') return 0; }
            if (!bp_value(p, depth+1)) return 0;
            bp_ws(p); if (**p == close) { ++*p; return 1; }
            if (**p != ',') return 0;
            ++*p; bp_ws(p);
        }
    }
    for (int i=0;i<3;i++) {
        const char *v = i==0 ? "true" : i==1 ? "false" : "null";
        size_t n = strlen(v);
        if (!strncmp(*p,v,n)) { *p+=n; return 1; }
    }
    if (**p == '-') ++*p;
    if (**p == '0') ++*p;
    else { if (**p<'1' || **p>'9') return 0; while (isdigit((unsigned char)**p)) ++*p; }
    if (**p == '.') { ++*p; if (!isdigit((unsigned char)**p)) return 0; while (isdigit((unsigned char)**p)) ++*p; }
    if (**p == 'e' || **p == 'E') {
        ++*p; if (**p == '+' || **p == '-') ++*p;
        if (!isdigit((unsigned char)**p)) return 0;
        while (isdigit((unsigned char)**p)) ++*p;
    }
    return 1;
}
static int bp_parse(const char *text, struct bp_config *cfg, struct bp_field fields[5], size_t *end, int *members)
{
    const char *p=text; int values[5]={80,5,0,0,0};
    memset(fields,0,5*sizeof(*fields)); *members=0;
    for (int i=0;i<5;i++) fields[i].key=bp_keys[i];
    bp_ws(&p); if (*p++ != '{') return EINVAL; bp_ws(&p);
    while (*p != '}') {
        const char *key=p, *value, *finish; char decoded[128], keyobj[256];
        if (*p != '"' || !bp_string(&p)) return EINVAL;
        size_t klen=(size_t)(p-key);
        if (klen+8>=sizeof keyobj) return EINVAL;
        memcpy(keyobj,"{\"k\":",5); memcpy(keyobj+5,key,klen); memcpy(keyobj+5+klen,"}",2);
        if (!json_get(keyobj,"k",decoded,sizeof decoded)) return EINVAL;
        /* Escaped aliases of owned keys must not create duplicate settings. */
        bp_ws(&p); if (*p++ != ':') return EINVAL; bp_ws(&p); value=p;
        if (!bp_value(&p,0)) return EINVAL;
        finish=p;
        for (int i=0;i<5;i++) if (!strcmp(decoded,bp_keys[i])) {
            if (fields[i].seen++) return EINVAL;
            fields[i].start=(size_t)(value-text); fields[i].end=(size_t)(finish-text);
            if (i<2) {
                char *stop; long v=strtol(value,&stop,10);
                if (stop!=finish || v<1 || v>100) return EINVAL;
                values[i]=(int)v;
            } else {
                if (finish-value==4 && !memcmp(value,"true",4)) values[i]=1;
                else if (finish-value==5 && !memcmp(value,"false",5)) values[i]=0;
                else return EINVAL;
            }
        }
        ++*members; bp_ws(&p);
        if (*p=='}') break;
        if (*p++!=',') return EINVAL;
        bp_ws(&p); if (*p=='}') return EINVAL;
    }
    *end=(size_t)(p-text); ++p; bp_ws(&p); if (*p) return EINVAL;
    if (values[0]<10 || values[0]>100 || values[1]<1 || values[1]>20) return EINVAL;
    *cfg=(struct bp_config){values[0],values[1],values[2],values[3],values[4]};
    return 0;
}
static int bp_read(const char *file, char text[BP_CAP])
{
    FILE *f=fopen(file,"rb"); if (!f) return errno;
    size_t n=fread(text,1,BP_CAP-1,f); int bad=ferror(f) || !feof(f); fclose(f);
    if (bad || !n || memchr(text,0,n)) return EINVAL;
    text[n]=0; return 0;
}
static int bp_load(const char *file, struct bp_config *cfg)
{
    char text[BP_CAP]; struct bp_field fields[5]; size_t end; int count, rc=bp_read(file,text);
    return rc ? rc : bp_parse(text,cfg,fields,&end,&count);
}
static int bp_edit(struct bp_config *c, const char *action)
{
    int delta=0;
    if (!strncmp(action,"chargelimit:",12)) {
        const char *s=action+12;
        if (!strcmp(s,"-5")) delta=-5; else if (!strcmp(s,"-1")) delta=-1;
        else if (!strcmp(s,"1")) delta=1; else if (!strcmp(s,"5")) delta=5; else return EINVAL;
        c->limit+=delta; if (c->limit<10) c->limit=10; if (c->limit>100) c->limit=100;
    } else if (!strncmp(action,"chargerecover:",14)) {
        if (!strcmp(action+14,"-1")) delta=-1; else if (!strcmp(action+14,"1")) delta=1; else return EINVAL;
        c->recover+=delta; if (c->recover<1) c->recover=1; if (c->recover>20) c->recover=20;
    } else if (!strcmp(action,"chargeprotect")) {
        c->protect=!c->protect; if (!c->protect) c->automatic=0;
    } else if (!strcmp(action,"chargeauto")) {
        c->automatic=!c->automatic; if (c->automatic) { c->protect=1; c->manual=0; }
    } else if (!strcmp(action,"dpson") || !strcmp(action,"dpsoff")) {
        c->manual=!strcmp(action,"dpson"); c->automatic=0;
    } else return EINVAL;
    if (c->recover>=c->limit) c->recover=c->limit-1;
    return 0;
}
static int bp_rewrite(const char *old, const struct bp_config *cfg, char out[BP_CAP])
{
    struct bp_field fields[5]; struct bp_config ignored; size_t end, pos=0, o=0; int count;
    int rc=bp_parse(old,&ignored,fields,&end,&count); if (rc) return rc;
    char val[5][16]; snprintf(val[0],16,"%d",cfg->limit); snprintf(val[1],16,"%d",cfg->recover);
    snprintf(val[2],16,"%s",cfg->protect?"true":"false"); snprintf(val[3],16,"%s",cfg->automatic?"true":"false");
    snprintf(val[4],16,"%s",cfg->manual?"true":"false");
    while (pos<end) {
        int found=-1; for (int i=0;i<5;i++) if (fields[i].seen && fields[i].start==pos) found=i;
        if (found<0) { if (o+1>=BP_CAP) return EFBIG; out[o++]=old[pos++]; }
        else { size_t n=strlen(val[found]); if (o+n>=BP_CAP) return EFBIG; memcpy(out+o,val[found],n); o+=n; pos=fields[found].end; }
    }
    for (int i=0;i<5;i++) if (!fields[i].seen) {
        int n=snprintf(out+o,BP_CAP-o,"%s\"%s\":%s",count++?",":"",bp_keys[i],val[i]);
        if (n<0 || (size_t)n>=BP_CAP-o) return EFBIG;
        o+=(size_t)n;
    }
    if (o+3>=BP_CAP) return EFBIG;
    memcpy(out+o,"}\n",3);
    return bp_parse(out,&ignored,fields,&end,&count);
}
static int bp_update(const char *file, const char *action)
{
    char old[BP_CAP], out[BP_CAP], current[BP_CAP], tmp[512], lock[512]; struct bp_config cfg;
    int fd=-1, lockfd=-1, rc=0; size_t end; int count; struct bp_field fields[5];
    if (snprintf(lock,sizeof lock,"%s.screen.lock",file)>=(int)sizeof lock ||
        snprintf(tmp,sizeof tmp,"%s.screen.XXXXXX",file)>=(int)sizeof tmp) return ENAMETOOLONG;
    lockfd=open(lock,O_CREAT|O_RDWR|O_CLOEXEC|O_NOFOLLOW,0600); if (lockfd<0) return errno;
    if (flock(lockfd,LOCK_EX|LOCK_NB)) { rc=EBUSY; goto done; }
    if ((rc=bp_read(file,old)) || (rc=bp_parse(old,&cfg,fields,&end,&count)) ||
        (rc=bp_edit(&cfg,action)) || (rc=bp_rewrite(old,&cfg,out))) goto done;
    if (!strcmp(old,out)) goto done;
    fd=mkstemp(tmp); if (fd<0) { rc=errno; goto done; }
    size_t n=strlen(out), written=0;
    while (written<n) { ssize_t k=write(fd,out+written,n-written); if (k<0 && errno==EINTR) continue;
        if (k<=0) { rc=errno?errno:EIO; break; } written+=(size_t)k; }
    if (!rc && fsync(fd)) rc=errno;
    if (close(fd) && !rc) rc=errno;
    fd=-1;
    /* The browser plugin has its own writer: never overwrite a detected edit. */
    if (!rc) { rc=bp_read(file,current); if (!rc && strcmp(old,current)) rc=EAGAIN; }
    if (!rc && rename(tmp,file)) rc=errno;
    if (rc) unlink(tmp);
    if (!rc) {
        char dir[512]; snprintf(dir,sizeof dir,"%s",file); char *slash=strrchr(dir,'/');
        if (slash) { *slash=0; int d=open(dir,O_RDONLY|O_DIRECTORY|O_CLOEXEC); if (d>=0) { (void)fsync(d); close(d); } }
    }
done:
    if (fd>=0) close(fd);
    close(lockfd); return rc;
}
static int bp_running(const char *binary, const char *pidfile)
{
    FILE *f=fopen(pidfile,"r"); long pid=0; char extra=0;
    if (!f) return 0;
    int n=fscanf(f,"%ld %c",&pid,&extra); fclose(f);
    if (n!=1 || pid<=1 || pid>2147483647L || kill((pid_t)pid,0)) return 0;
    char proc[64]; struct stat actual, expected;
    snprintf(proc,sizeof proc,"/proc/%ld/exe",pid);
    if (!stat(proc,&actual) && !stat(binary,&expected) &&
        actual.st_ino==expected.st_ino && actual.st_dev==expected.st_dev) return 1;
    /* The supplied battery monitor is a shell script, so /proc/PID/exe points
     * to BusyBox/sh. Match an entire argv item, not a substring or PID alone. */
    char args[4096];
    snprintf(proc,sizeof proc,"/proc/%ld/cmdline",pid);
    f=fopen(proc,"rb"); if (!f) return 0;
    size_t used=fread(args,1,sizeof args-1,f); int bad=ferror(f); fclose(f);
    if (bad || !used || used==sizeof args-1) return 0;
    args[used]=0;
    for (size_t offset=0;offset<used;) {
        size_t len=strlen(args+offset);
        if (!strcmp(args+offset,binary)) return 1;
        offset+=len+1;
    }
    return 0;
}
#endif
