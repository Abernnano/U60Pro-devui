/* No network or router I/O. Fake curl is a separate process with the same argv/
 * private-header/payload/output contract as the real client. */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <stdint.h>
#include <signal.h>
#include <time.h>
#include <unistd.h>
#include <sys/stat.h>
static char fixture[320],ctl[384],bin[384],logfile[384],lockfile[384],cachefile[384];
struct plugin_candidate {const char *dir,*ctl,*bin;};
static const struct plugin_candidate g_mh_candidates[]={{fixture,ctl,bin}};
#define ARRAY_LEN(x) (sizeof(x)/sizeof((x)[0]))
#define MIHOMO_ACTION_LOG logfile
#define MH_LOCK lockfile
#define MX_CACHE cachefile
static const struct plugin_candidate *plugin_script_select(const struct plugin_candidate *p,size_t n,int require){(void)n;(void)require;return p;}
#include "mihomo_control.h"
#include "mihomo_api.h"
static void html_esc(char *out,size_t cap,const char *s){size_t n=0;for(;*s;s++){const char *v=*s=='<'?"&lt;":*s=='>'?"&gt;":*s=='&'?"&amp;":*s=='\"'?"&quot;":NULL;if(v){size_t k=strlen(v);if(n+k>=cap)break;memcpy(out+n,v,k);n+=k;}else{if(n+1>=cap)break;out[n++]=*s;}}out[n]=0;}
#include "mihomo_ui.h"
static int checks;
#define CHECK(x) do{checks++;if(!(x)){fprintf(stderr,"FAIL %d: %s; %s\n",__LINE__,#x,mx_error);exit(1);}}while(0)
static const char *group="选择 \"组\"/中",*node="香港 / A\";$(touch PWN)<x>";
static void setup(const char *dir){snprintf(fixture,sizeof fixture,"%s",dir);snprintf(ctl,sizeof ctl,"%s/mm.sh",dir);snprintf(bin,sizeof bin,"%s/mihomo",dir);snprintf(logfile,sizeof logfile,"%s/action.log",dir);snprintf(lockfile,sizeof lockfile,"%s/action.lock",dir);snprintf(cachefile,sizeof cachefile,"%s/nodes.json",dir);}
static const char *mode(void){const char *s=getenv("MX_TEST_MODE");return s?s:"ok";}
static void pathof(char *p,size_t n,const char *s){snprintf(p,n,"%s/%s",fixture,s);}
static void config(const char *s){char p[512];pathof(p,sizeof p,"config.yaml");CHECK(mx_write(p,s));}
static void setmode(const char *s){setenv("MX_TEST_MODE",s,1);}
static char *snapshot(void)
{
    static char out[8192];char g[2048],n[2048],p[512],now[2048];mx_encode(group,g,sizeof g,1);mx_encode(node,n,sizeof n,1);
    pathof(p,sizeof p,"selected");char *selected=mx_read(p,4096);mx_encode(selected?selected:"DIRECT",now,sizeof now,1);free(selected);
    snprintf(out,sizeof out,"{\"proxies\":{%s:{\"type\":\"Selector\",\"now\":%s,\"all\":[\"DIRECT\",%s,\"REJECT\",\"A\",\"B\",\"C\"]},%s:{\"type\":\"Vmess\",\"history\":[{\"delay\":42}]},\"自动\":{\"type\":\"URLTest\",\"now\":\"DIRECT\",\"all\":[\"DIRECT\"]}}}",g,now,n,n);return out;
}
static int data_fixture(const char *out,int i)
{
    FILE *fp=fopen(out,"wb");if(!fp)return 1;
    if(i<2){for(int n=0;n<20;n++)fputs(i?"2400:3200::/32\n":"1.0.1.0/24\n",fp);}
    if(i==2){fputc(10,fp);fputc(120,fp);for(int n=0;n<120;n++)fputc(1,fp);}
    if(i==3){for(int n=0;n<140;n++)fputc(0,fp);const unsigned char m[]={0xab,0xcd,0xef,'M','a','x','M','i','n','d','.','c','o','m'};fwrite(m,1,sizeof m,fp);}
    if(i==4)fputs("20260928\n",fp);return fclose(fp)?1:0;
}
static int fake_curl(int argc,char **argv)
{
    const char *url=NULL,*output=NULL,*header=NULL,*body=NULL,*method="GET";int tls=0,noproxy=0;
    for(int i=1;i<argc;i++){if(!strcmp(argv[i],"--url")&&i+1<argc)url=argv[++i];else if(!strcmp(argv[i],"-o")&&i+1<argc)output=argv[++i];else if(!strcmp(argv[i],"-H")&&i+1<argc)header=argv[++i];else if(!strcmp(argv[i],"--data-binary")&&i+1<argc)body=argv[++i];else if(!strcmp(argv[i],"-X")&&i+1<argc)method=argv[++i];else if(!strcmp(argv[i],"--proto"))tls=1;else if(!strcmp(argv[i],"--noproxy"))noproxy=1;
        if(strstr(argv[i],"test-secret")||!strcmp(argv[i],"-k"))return 95;}
    if(!url||!output)return 96;
    if(!strncmp(url,"https://github.com/",19)){
        if(!tls)return 97;const char *name=strrchr(url,'/');if(!name)return 98;int idx=-1;for(int i=0;i<5;i++)if(!strcmp(name+1,mx_files[i]))idx=i;if(idx<0)return 99;
        if(!strcmp(mode(),"downloadfail")&&idx==2)return 22;
        if(!strcmp(mode(),"fallback")&&strstr(url,"Jack-bin183"))return 22;
        if(!strcmp(mode(),"html")&&idx==2)return mx_write(output,"<html>error</html>")?0:1;
        return data_fixture(output,idx);
    }
    if(!noproxy||!header||header[0]!='@')return 92;struct stat st;if(stat(header+1,&st)||((st.st_mode&0777)!=0600))return 93;
    char *h=mx_read(header+1,4096);if(!h||!strstr(h,"Authorization: Bearer test-secret")){free(h);return 22;}free(h);
    if(!strcmp(mode(),"apifail"))return 22;
    if(!strcmp(mode(),"malformed"))return mx_write(output,"{\"proxies\":{")?0:1;
    if(strstr(url,"/group/"))return mx_write(output,"{\"DIRECT\":35,\"A\":100,\"B\":0}")?0:1;
    const char *p=strstr(url,"/proxies");if(!p)return 94;
    if(strstr(p,"/delay?"))return mx_write(output,!strcmp(mode(),"delaybad")?"{\"delay\":0}":"{\"delay\":37}")?0:1;
    if(!strcmp(method,"PUT")){
        if(!body||body[0]!='@')return 91;char *b=mx_read(body+1,8192),selected[MX_NAME];if(!b)return 90;
        int good=mx_text(mx_field(mx_parse(b),"name"),selected,sizeof selected);free(b);if(!good||strcmp(selected,node))return 89;
        char file[512];pathof(file,sizeof file,"selected");if(strcmp(mode(),"readbackfail"))mx_write(file,selected);return mx_write(output,"")?0:1;
    }
    if(!strcmp(p,"/proxies"))return mx_write(output,snapshot())?0:1;
    char encoded[MX_NAME*3];mx_encode(group,encoded,sizeof encoded,0);if(strcmp(p+9,encoded))return 88;
    mxj obj=mx_field(mx_field(mx_parse(snapshot()),"proxies"),group);if(!obj.p)return 87;
    char data[8192];size_t n=(size_t)(obj.e-obj.p);memcpy(data,obj.p,n);data[n]=0;return mx_write(output,data)?0:1;
}
static void json_tests(void)
{
    CHECK(mx_parse("{}").p);CHECK(!mx_parse("{bad}").p);CHECK(!mx_parse("{\"x\":1,}").p);CHECK(!mx_parse("[1,]").p);CHECK(!mx_parse("truefalse").p);CHECK(!mx_parse("\"\\uZZZZ\"").p);CHECK(!mx_parse("01").p);CHECK(!mx_parse("1.").p);CHECK(!mx_parse("- ").p);CHECK(!mx_parse("1e").p);
    char b[4096];CHECK(mx_text(mx_parse("\"\\u9999\\u6e2f \\ud83d\\ude80\""),b,sizeof b));CHECK(!strcmp(b,"香港 🚀"));CHECK(!mx_text(mx_parse("\"a\\u0000b\""),b,sizeof b));CHECK(!mx_text(mx_parse("\"a\\nb\""),b,sizeof b));
    CHECK(mx_field(mx_parse("{\"outer\":{\"now\":1},\"now\":2}"),"now").p[0]=='2');
    CHECK(mx_encode(node,b,sizeof b,0));CHECK(strstr(b,"%22%3B%24%28"));CHECK(!strchr(b,' '));CHECK(!mx_encode(node,b,3,0));
    char h[4096];CHECK(mx_hex(node,h,sizeof h));CHECK(mx_unhex(h,strlen(h),b,sizeof b));CHECK(!strcmp(b,node));CHECK(!mx_unhex("00",2,b,sizeof b));CHECK(!mx_unhex("xy",2,b,sizeof b));CHECK(!mx_unhex("a",1,b,sizeof b));
    char deep[300];memset(deep,'[',70);memset(deep+70,']',70);deep[140]=0;CHECK(!mx_parse(deep).p);
    mxj root=mx_parse(snapshot());CHECK(root.p);CHECK(mx_group(root,0,b,sizeof b).p);CHECK(!strcmp(b,group));CHECK(mx_group(root,1,b,sizeof b).p);CHECK(!mx_group(root,2,b,sizeof b).p);
}
static void config_tests(void)
{
    char base[128],secret[2048];
    config("external-controller: '0.0.0.0:9090' # local\nsecret: \"test-secret\"\n");CHECK(mx_config(fixture,base,sizeof base,secret,sizeof secret));CHECK(!strcmp(base,"http://127.0.0.1:9090"));CHECK(!strcmp(secret,"test-secret"));
    config("external-controller: '[::]:9090'\nsecret: 'a''b'\n");CHECK(mx_config(fixture,base,sizeof base,secret,sizeof secret));CHECK(!strcmp(secret,"a'b"));
    config("external-controller: evil.example:9090\n");CHECK(!mx_config(fixture,base,sizeof base,secret,sizeof secret));
    config("external-controller: :9090\nsecret: |\n  foo\n");CHECK(!mx_config(fixture,base,sizeof base,secret,sizeof secret));
    config("external-controller: :9090\nexternal-controller: :9091\n");CHECK(!mx_config(fixture,base,sizeof base,secret,sizeof secret));
    config("external-controller: :0\n");CHECK(!mx_config(fixture,base,sizeof base,secret,sizeof secret));
    config("external-controller: :9090\nsecret: \"test-secret\" # comment\n");CHECK(mx_config(fixture,base,sizeof base,secret,sizeof secret));
}
static void worker_tests(void)
{
    char gh[2048],nh[2048],verb[5000],p[512];mx_hex(group,gh,sizeof gh);mx_hex(node,nh,sizeof nh);snprintf(verb,sizeof verb,"mxselect:%s:%s",gh,nh);
    CHECK(mx_worker("mxrefresh")==0);char *s=mx_read(cachefile,MX_LIMIT);CHECK(s&&mx_parse(s).p);free(s);
    setmode("readbackfail");CHECK(mx_worker(verb)==1);setmode("ok");CHECK(mx_worker(verb)==0);
    pathof(p,sizeof p,"selected");s=mx_read(p,4096);CHECK(s&&!strcmp(s,node));free(s);
    snprintf(verb,sizeof verb,"mxtest:%s:%s",gh,nh);CHECK(mx_worker(verb)==0);s=mx_read(logfile,4096);CHECK(s&&strstr(s,"37 ms"));CHECK(!strstr(s,"test-secret"));free(s);
    setmode("delaybad");CHECK(mx_worker(verb)==1);setmode("apifail");CHECK(mx_worker("mxrefresh")==1);setmode("malformed");CHECK(mx_worker("mxrefresh")==1);setmode("ok");
    snprintf(verb,sizeof verb,"mxgroup:%s",gh);CHECK(mx_worker(verb)==0);s=mx_read(logfile,4096);CHECK(s&&strstr(s,"2 个成功，4 个失败"));free(s);
    CHECK(mx_worker("mxselect:bad:00")==1);CHECK(mx_worker("mxBAD")==1);
    int fd=mh_lock_open();CHECK(fd>=0);CHECK(flock(fd,LOCK_EX|LOCK_NB)==0);CHECK(mx_worker("mxrefresh")==75);close(fd);
    pathof(p,sizeof p,"PWN");CHECK(access(p,F_OK)!=0);
    char *args[]={"/bin/sh","-c","sleep 20",NULL};long long before=mx_ms();CHECK(!mx_run(args,1));CHECK(mx_ms()-before<2500);
}
static void update_tests(void)
{
    char p[512];for(int i=0;i<5;i++){pathof(p,sizeof p,mx_files[i]);CHECK(mx_write(p,"OLD"));}
    setmode("downloadfail");CHECK(mx_worker("mxupdate")==1);for(int i=0;i<5;i++){pathof(p,sizeof p,mx_files[i]);char *s=mx_read(p,1024);CHECK(s&&!strcmp(s,"OLD"));free(s);}
    setmode("html");CHECK(mx_worker("mxupdate")==1);setmode("fallback");CHECK(mx_worker("mxupdate")==0);
    for(int i=0;i<5;i++){pathof(p,sizeof p,mx_files[i]);CHECK(mx_validate_file(p,i));}
    setmode("ok");pathof(p,sizeof p,"GeoSite.dat");unlink(p);CHECK(symlink("protected-target",p)==0);CHECK(mx_worker("mxupdate")==1);struct stat st;CHECK(lstat(p,&st)==0&&S_ISLNK(st.st_mode));unlink(p);
    pathof(p,sizeof p,"bad");CHECK(mx_write(p,"<html>something that definitely is not a database</html>"));for(int i=0;i<5;i++)CHECK(!mx_validate_file(p,i));
}
static void ui_tests(void)
{
    CHECK(mx_worker("mxrefresh")==0);const char *s=mx_ui();CHECK(strstr(s,"act:mxselect:1"));CHECK(strstr(s,"&lt;x&gt;"));CHECK(!strstr(s,"<x>"));CHECK(!strstr(s,"act:mxselect:4"));
    char message[256];CHECK(mx_action("mxnext",message,sizeof message));CHECK(strstr(mx_ui(),"act:mxselect:4"));CHECK(!strstr(mx_ui(),"act:mxselect:1"));
    CHECK(mx_action("mxgnext",message,sizeof message));CHECK(!strstr(mx_ui(),"act:mxselect:"));CHECK(mx_action("mxgprev",message,sizeof message));
    CHECK(mx_action("mxupdate",message,sizeof message));CHECK(strstr(message,"确认"));CHECK(mx_action("mxaskupdate",message,sizeof message));CHECK(strstr(mx_ui(),"act:mxupdate"));CHECK(mx_action("mxcancel",message,sizeof message));
    CHECK(mx_action("mxselect:99999999999999",message,sizeof message));CHECK(strstr(message,"无效"));
    mx_stamp.st_mtime=time(NULL)-301;CHECK(mx_action("mxselect:1",message,sizeof message));CHECK(strstr(message,"过期"));
}
int main(int argc,char **argv)
{
    const char *dir=getenv("DEVUI_MX_TEST_ROOT");if(!dir)return 2;setup(dir);
    if(!strcmp(argv[0],"curl")||strstr(argv[0],"/curl"))return fake_curl(argc,argv);
    if(argc==3&&!strcmp(argv[1],"--mihomo-control"))return mx_worker(argv[2]);
    if(argc==2&&!strcmp(argv[1],"--validate-data")){for(int i=0;i<5;i++){char p[512];pathof(p,sizeof p,mx_files[i]);CHECK(mx_validate_file(p,i));}printf("PASS 5 downloaded upstream data-file validations\n");return 0;}
    char p[512];pathof(p,sizeof p,"curl");CHECK(symlink("/proc/self/exe",p)==0);char exe[512];ssize_t n=readlink("/proc/self/exe",exe,sizeof exe-1);CHECK(n>0);exe[n]=0;unlink(p);CHECK(symlink(exe,p)==0);
    char envpath[1024];snprintf(envpath,sizeof envpath,"%s:/bin:/usr/bin",fixture);setenv("PATH",envpath,1);
    json_tests();config_tests();worker_tests();update_tests();ui_tests();printf("PASS %d proxy checks (isolated fake-curl child processes; no router/network I/O)\n",checks);return 0;
}
