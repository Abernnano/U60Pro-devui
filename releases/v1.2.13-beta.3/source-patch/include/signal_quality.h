/* Signal quality model adapted from the user-supplied signal monitor v2.15.
 * Pure, bounded, allocation-free functions shared with the regression tests.
 * SPDX-License-Identifier: MIT */
#ifndef DEVUI_SIGNAL_QUALITY_H
#define DEVUI_SIGNAL_QUALITY_H
#include "data.h"
#include <math.h>
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define SQ_MAX_CARRIERS 20
struct sq_carrier { double v[4], bw, role; int nr; long pci, arfcn; };
struct sq_result { int score, count, excluded, weakest, nr_count, lte_count; double v[4]; };
static const double sq_limits[4][4] = {
    {-85,-95,-105,-120}, {-10,-15,-20,-30}, {-65,-75,-85,-100}, {20,13,5,0}
};
static int sq_metric_score(int metric, double v)
{
    static const int points[] = {100,80,55,20};
    if (metric < 0 || metric > 3 || !isfinite(v)) return -1;
    for (int i=0;i<4;i++) if (v >= sq_limits[metric][i]) return points[i];
    return 0;
}
static double sq_number(const char *s)
{
    char *e; double v;
    if (!s) return NAN;
    v=strtod(s,&e);
    if (e==s || !isfinite(v)) return NAN;
    while (isspace((unsigned char)*e)) e++;
    if (*e && strcmp(e,"dBm") && strcmp(e,"dB") && strcmp(e,"MHz")) return NAN;
    return v;
}
static double sq_valid(int i, double v)
{
    static const double lo[]={-160,-50,-150,-40}, hi[]={-30,0,-10,60};
    return isfinite(v) && v>=lo[i] && v<=hi[i] ? v : NAN;
}
static struct sq_carrier sq_empty(int nr, double role)
{
    struct sq_carrier c;
    for (int i=0;i<4;i++) c.v[i]=NAN;
    c.bw=NAN; c.role=role; c.nr=nr; c.pci=c.arfcn=-1;
    return c;
}
static int sq_loaded(const struct sq_carrier *c)
{
    int n=0,extreme=0; static const double lim[]={-135,-35,-115,-15};
    for (int i=0;i<4;i++) if (isfinite(c->v[i])) { n++; extreme+=c->v[i]<=lim[i]; }
    return n && extreme<3;
}
static int sq_carrier_score(const struct sq_carrier *c)
{
    static const int w[]={35,20,15,30}; int total=0,weight=0;
    for (int i=0;i<4;i++) { int s=sq_metric_score(i,c->v[i]); if (s>=0) {total+=s*w[i];weight+=w[i];} }
    return weight ? (int)((double)total/weight+0.5) : -1;
}
static struct sq_result sq_evaluate(const struct sq_carrier *c, int n)
{
    struct sq_result r={0}; double total=0, weight=0, sums[4]={0}, ws[4]={0};
    r.score=-1; r.weakest=100;
    if (n>SQ_MAX_CARRIERS) n=SQ_MAX_CARRIERS;
    for (int j=0;j<n;j++) {
        double bw,w; int score;
        if (!sq_loaded(c+j)) {r.excluded++;continue;}
        score=sq_carrier_score(c+j); if (score<0) continue;
        bw=isfinite(c[j].bw) ? fmax(0.75,fmin(1.5,c[j].bw/20.0)) : 1.0;
        w=c[j].role*bw; total+=score*w;weight+=w;r.count++;
        if (c[j].nr) r.nr_count++; else r.lte_count++;
        if (score<r.weakest) r.weakest=score;
        for (int i=0;i<4;i++) if (isfinite(c[j].v[i])) { sums[i]+=c[j].v[i]*w;ws[i]+=w; }
    }
    for (int i=0;i<4;i++) r.v[i]=ws[i] ? sums[i]/ws[i] : NAN;
    if (weight>0) r.score=(int)(total/weight*0.75+r.weakest*0.25+0.5);
    return r;
}
/* Unlike strtok, retain empty CSV columns. Otherwise a missing RSRQ can
 * silently shift SINR/RSSI and turn bad coverage into an excellent score. */
static int sq_split(char *s, char sep, char **out, int cap)
{
    int n=0;
    if (!s || !*s) return 0;
    while (n<cap) { char *p;out[n++]=s;p=strchr(s,sep);if (!p) break;*p=0;s=p+1; }
    return n;
}
static int sq_groups(char *s, char **out, int cap)
{
    int n=0;
    if (strstr(s,"(H:")) {
        while (n<cap && (s=strstr(s,"(H:"))) { char *end;s+=3;end=strchr(s,')');if (!end) break;out[n++]=s;*end=0;s=end+1; }
        return n;
    }
    return sq_split(s,';',out,cap);
}
static void sq_full_metrics(struct sq_carrier *c, char **f, int nf)
{
    static const int at[]={7,8,10,9};
    for (int i=0;i<4;i++) if (nf>at[i]) c->v[i]=sq_valid(i,sq_number(f[at[i]]));
}
static void sq_merge_missing(struct sq_carrier *a, const struct sq_carrier *b)
{
    for (int i=0;i<4;i++) if (!isfinite(a->v[i])) a->v[i]=b->v[i];
    if (!isfinite(a->bw)) a->bw=b->bw;
    if (a->pci<0) a->pci=b->pci;
    if (a->arfcn<0) a->arfcn=b->arfcn;
}
static long sq_identity(const char *s)
{
    double v=sq_number(s);return isfinite(v) && v>=0 && v<2147483647.0 ? (long)v : -1;
}
static int sq_from_data(const devui_data_t *d, struct sq_carrier *out)
{
    int n=0, nr, lte, nsa;
    if (!d || !d->valid) return 0;
    nsa=strstr(d->net_type,"NSA") || strstr(d->net_type,"ENDC") || strstr(d->net_type,"EN-DC");
    nr=nsa || strstr(d->net_type,"SA") || strstr(d->net_type,"5G") || strstr(d->net_type,"NR");
    lte=nsa || (!nr && (strstr(d->net_type,"LTE") || strstr(d->net_type,"4G")));
    for (int rat=1;rat>=0;rat--) {
        int base,ng,ns; char ca[256],sig[256],*groups[8],*sigs[8];
        struct sq_carrier primary; int raw[3];
        if (rat ? !nr : !lte) continue;
        primary=sq_empty(rat,rat || !nr ? 1.2 : 1.0);
        raw[0]=rat?d->nr_rsrp:d->lte_rsrp;raw[1]=rat?d->nr_rsrq:d->lte_rsrq;raw[2]=rat?d->nr_rssi:d->lte_rssi;
        for (int i=0;i<3;i++) primary.v[i]=raw[i] ? sq_valid(i,raw[i]) : NAN;
        primary.v[3]=sq_valid(3,sq_number(rat?d->nr_snr:d->lte_snr));
        if (rat) {primary.bw=sq_number(d->nr_bw);primary.pci=d->nr_pci;primary.arfcn=d->nr_channel;}
        base=n;out[n++]=primary;
        snprintf(ca,sizeof ca,"%s",rat?d->nrca:d->lteca);
        snprintf(sig,sizeof sig,"%s",rat?"":d->ltecasig);
        ng=sq_groups(ca,groups,8);ns=sq_groups(sig,sigs,8);
        for (int g=0;g<ng && n<SQ_MAX_CARRIERS;g++) {
            char *f[16];int nf=sq_split(groups[g],',',f,16),is_primary=0;
            struct sq_carrier c=sq_empty(rat,0.9);
            if (nf>=8) {
                c.pci=sq_identity(f[1]);c.arfcn=sq_identity(f[4]);c.bw=sq_number(f[5]);
                sq_full_metrics(&c,f,nf);
                if (!rat && g==0) is_primary=1; /* same PCell-first contract as carrier cards */
                if (rat && primary.arfcn>0 && c.arfcn==primary.arfcn && c.pci==primary.pci) is_primary=1;
            } else if (!rat && nf>=5) {
                c.pci=sq_identity(f[0]);c.arfcn=sq_identity(f[3]);c.bw=sq_number(f[4]);
                /* Legacy backend layout explicitly includes the PCell first. */
                is_primary=(g==0);
            } else continue;
            if (!rat && ns) {
                int si=ns==ng ? g : ns==ng-1 ? g-1 : -1;
                if (si>=0 && si<ns) {
                    char *sf[16];int sn=sq_split(sigs[si],',',sf,16);
                    struct sq_carrier sc=sq_empty(0,0.9);
                    if (sn>=8) sq_full_metrics(&sc,sf,sn);
                    else { /* known compact order: [identity...,] RSRP,RSRQ,SINR[,RSSI] */
                        for (int k=0;k<sn;k++) if (isfinite(sq_valid(0,sq_number(sf[k])))) {
                            sc.v[0]=sq_valid(0,sq_number(sf[k]));
                            if (sn-k>=3) {sc.v[1]=sq_valid(1,sq_number(sf[k+1]));sc.v[3]=sq_valid(3,sq_number(sf[k+2]));}
                            if (sn-k>=4) sc.v[2]=sq_valid(2,sq_number(sf[k+3]));
                            if (sn-k==2) sc.v[3]=sq_valid(3,sq_number(sf[k+1]));
                            break;
                        }
                    }
                    sq_merge_missing(&c,&sc);
                }
            }
            if (is_primary) {sq_merge_missing(out+base,&c);continue;}
            int duplicate=0;
            for (int k=base;k<n;k++) if (c.arfcn>0 && c.arfcn==out[k].arfcn && c.pci==out[k].pci) {sq_merge_missing(out+k,&c);duplicate=1;break;}
            if (!duplicate) out[n++]=c;
        }
    }
    return n;
}
#endif
