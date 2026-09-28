/* Linux integration tests. All fixtures stay in one mkdtemp directory;
 * no router, network rules, real plugin files or running services are touched. */
#define _GNU_SOURCE
#include "signal_quality.h"
#include <assert.h>
#include <stdint.h>
#include <signal.h>
#include <time.h>
#include <unistd.h>
#include <sys/stat.h>
static char fixture[320],ctl[384],bin[384],logfile[384],lockfile[384];
struct plugin_candidate {const char *dir,*ctl,*bin;};
static const struct plugin_candidate g_mh_candidates[]={{fixture,ctl,bin}};
#define ARRAY_LEN(x) (sizeof(x)/sizeof((x)[0]))
#define MIHOMO_ACTION_LOG logfile
#define MH_LOCK lockfile
static const struct plugin_candidate *plugin_script_select(const struct plugin_candidate *items,size_t count,int require_bin)
{
    for(size_t i=0;i<count;i++) if(access(items[i].ctl,R_OK)==0 && (!require_bin || access(items[i].bin,X_OK)==0))return items+i;
    return NULL;
}
#include "mihomo_control.h"
static int checks;
#define CHECK(x) do { checks++; if(!(x)){fprintf(stderr,"FAIL line %d: %s\n",__LINE__,#x);exit(1);} } while(0)
static void put(const char *path,const char *text) {FILE *f=fopen(path,"w");assert(f);fputs(text,f);fclose(f);}
static void readlog(char *s,size_t cap) {FILE *f=fopen(logfile,"r");assert(f);size_t n=fread(s,1,cap-1,f);s[n]=0;fclose(f);}
static void configure_fixture(const char *dir)
{
    snprintf(fixture,sizeof fixture,"%s",dir);snprintf(ctl,sizeof ctl,"%s/mm.sh",dir);snprintf(bin,sizeof bin,"%s/mihomo",dir);
    snprintf(logfile,sizeof logfile,"%s/action.log",dir);snprintf(lockfile,sizeof lockfile,"%s/action.lock",dir);
}
static void quality_tests(void)
{
    const int scores[]={100,80,55,20};
    for(int m=0;m<4;m++)for(int t=0;t<4;t++){
        CHECK(sq_metric_score(m,sq_limits[m][t])==scores[t]);
        CHECK(sq_metric_score(m,sq_limits[m][t]-0.001)==(t==3?0:scores[t+1]));
    }
    CHECK(isnan(sq_number("--")));CHECK(isnan(sq_number("NaN")));CHECK(isnan(sq_number("20wrong")));
    CHECK(sq_number("-90dBm")==-90);CHECK(sq_number("0")==0);CHECK(isnan(sq_valid(0,0)));
    struct sq_carrier c[20];c[0]=sq_empty(1,1.2);c[1]=sq_empty(1,.9);
    CHECK(sq_evaluate(c,1).score==-1);
    c[0].v[0]=-85;CHECK(sq_evaluate(c,1).score==100); /* one real metric is allowed */
    c[0].bw=100;c[1].bw=20;c[1].v[0]=-120;CHECK(sq_evaluate(c,2).score==60);
    for(int i=0;i<4;i++)c[1].v[i]=(double[]){-140,-40,-120,-20}[i];
    CHECK(sq_evaluate(c,2).count==1);CHECK(sq_evaluate(c,2).score==100);
    c[1].v[2]=-80;c[1].v[3]=10;CHECK(sq_loaded(c+1)); /* two weak metrics are not an unloaded carrier */
    devui_data_t d={0};d.valid=1;strcpy(d.net_type,"LTE");d.lte_rsrp=-85;d.lte_rsrq=-10;d.lte_rssi=-65;strcpy(d.lte_snr,"20");
    d.nr_rsrp=-50;strcpy(d.nr_snr,"50"); /* stale NR must not contaminate LTE */
    int n=sq_from_data(&d,c);CHECK(n==1);CHECK(sq_evaluate(c,n).nr_count==0);CHECK(sq_evaluate(c,n).score==100);
    strcpy(d.lteca,"100,3,0,1650,20;101,7,0,3100,10");strcpy(d.ltecasig,"-120,-30,0,-100");
    n=sq_from_data(&d,c);CHECK(n==2);CHECK(c[1].v[0]==-120);CHECK(c[1].v[3]==0);CHECK(sq_evaluate(c,n).score==58);
    memset(&d,0,sizeof d);d.valid=1;strcpy(d.net_type,"LTE");
    strcpy(d.lteca,"0,100,0,3,1650,20,0,-95,-15,13,-75");
    n=sq_from_data(&d,c);CHECK(n==1);CHECK(sq_evaluate(c,n).score==80);
    memset(&d,0,sizeof d);d.valid=1;strcpy(d.net_type,"SA");d.nr_pci=100;d.nr_channel=640000;d.nr_rsrp=-85;d.nr_rsrq=-10;d.nr_rssi=-65;strcpy(d.nr_snr,"20");strcpy(d.nr_bw,"100");
    strcpy(d.nrca,"(H:1,101,0,78,641000,100,0,-95,,13,-75)");
    n=sq_from_data(&d,c);CHECK(n==2);CHECK(isnan(c[1].v[1]));CHECK(c[1].v[2]==-75);CHECK(c[1].v[3]==13);CHECK(sq_evaluate(c,n).score==89);
    strcpy(d.nrca,"0,100,0,78,640000,100,0,-85,-10,20,-65");n=sq_from_data(&d,c);CHECK(n==1);CHECK(sq_evaluate(c,n).score==100);
    strcpy(d.nrca,"0,101,0,78,641000,100,0,-140,-40,-20,-120");n=sq_from_data(&d,c);CHECK(sq_evaluate(c,n).count==1);
    d.valid=0;CHECK(sq_from_data(&d,c)==0);d.valid=1;strcpy(d.net_type,"NO SERVICE");CHECK(sq_from_data(&d,c)==0);
}
static long long clock_ms(void) {struct timespec ts;clock_gettime(CLOCK_MONOTONIC,&ts);return ts.tv_sec*1000LL+ts.tv_nsec/1000000;}
static void worker_tests(void)
{
    char path[400],out[8192];struct stat st;
    put(bin,"#!/bin/sh\nexit 0\n");chmod(bin,0700);
    put(ctl,"#!/bin/sh\ncase \"$1\" in\nstart|restart) echo RUN:$1; pwd; echo ran > ran; [ ! -f slow ] || sleep 1; [ ! -f fail ] || exit 23; [ ! -f noisy ] || { yes x | head -c 2000000; }; echo end-marker;;\nstop) echo stopped;;\n*) exit 64;;\nesac\n");
    CHECK(mh_supports(ctl,"start"));CHECK(mh_supports(ctl,"restart"));CHECK(!mh_supports(ctl,"reload-ipset"));
    CHECK(mh_control_worker("bad;command")==64);
    CHECK(mh_control_worker("start")==1); /* missing config */
    snprintf(path,sizeof path,"%s/ran",fixture);CHECK(access(path,F_OK)!=0);
    snprintf(path,sizeof path,"%s/config.yaml",fixture);put(path,"mode: rule\n");
    CHECK(mh_control_worker("start")==0);readlog(out,sizeof out);CHECK(strstr(out,fixture));CHECK(strstr(out,"end-marker"));
    snprintf(path,sizeof path,"%s/fail",fixture);put(path,"");CHECK(mh_control_worker("restart")==23);readlog(out,sizeof out);CHECK(strstr(out,"rc=23"));unlink(path);
    snprintf(path,sizeof path,"%s/noisy",fixture);put(path,"");CHECK(mh_control_worker("start")==0);CHECK(stat(logfile,&st)==0 && st.st_size<4600);readlog(out,sizeof out);CHECK(strstr(out,"end-marker"));unlink(path);
    snprintf(path,sizeof path,"%s/slow",fixture);put(path,"");
    CHECK(mh_submit("start")==0);CHECK(mh_busy());CHECK(mh_submit("stop")==EBUSY);
    usleep(150000);CHECK(mh_control_worker("stop")==75); /* cross-process OS lock */
    long long end=clock_ms()+3000;while(g_mh_worker && clock_ms()<end){mh_reap();usleep(10000);}
    CHECK(!g_mh_worker);CHECK(!mh_busy());unlink(path);
    CHECK(mh_control_worker("stop")==0);
    CHECK(mh_capture("printf hello",out,sizeof out,500));CHECK(!strcmp(out,"hello"));
    CHECK(!mh_capture("exit 7",out,sizeof out,500));
    long long t=clock_ms();CHECK(!mh_capture("sleep 3",out,sizeof out,150));CHECK(clock_ms()-t<1000);
    CHECK(mh_capture("yes x | head -c 100000",out,32,1000));CHECK(strlen(out)==31);
    put(ctl,"#!/bin/sh\n# start) must not count\ncase \"$1\" in\nstatus) echo noop;;\n*) echo DANGEROUS;;\nesac\n");
    CHECK(!mh_supports(ctl,"start"));CHECK(mh_control_worker("start")==1);readlog(out,sizeof out);CHECK(!strstr(out,"DANGEROUS"));
}
#include "reference-vectors.h"
int main(int argc,char **argv)
{
    const char *dir=getenv("DEVUI_BETA_TEST_ROOT");char tmp[]="/tmp/devui-beta-XXXXXX";
    if(!dir){dir=mkdtemp(tmp);if(!dir)return 2;setenv("DEVUI_BETA_TEST_ROOT",dir,1);}
    configure_fixture(dir);
    if(argc==3 && !strcmp(argv[1],"--mihomo-control"))return mh_control_worker(argv[2]);
    quality_tests();reference_tests();worker_tests();
    printf("PASS %d checks; signal model + real child-process control, lock, return code, output bounds, diagnostic deadlines\n",checks);
    printf("Isolated test fixtures: %s\n",dir);return 0;
}
