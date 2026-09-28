/* Real Mihomo REST actions. Invoked only in the detached, flock-protected worker.
 * No shell interpolation, no subscription/secret in logs, bounded HTTP and output. */
#ifndef DEVUI_MIHOMO_API_H
#define DEVUI_MIHOMO_API_H
#include <arpa/inet.h>
#include <sys/resource.h>
#include "mihomo_json.h"
#ifndef MX_CACHE
#define MX_CACHE "/tmp/devui-mihomo-nodes.json"
#endif
#define MX_LIMIT (2*1024*1024)
#define MX_NAME 1024
static char mx_error[256];
static long long mx_ms(void){struct timespec ts;clock_gettime(CLOCK_MONOTONIC,&ts);return ts.tv_sec*1000LL+ts.tv_nsec/1000000;}
static int mx_run_limit(char *const args[],int seconds,rlim_t bytes)
{
    pid_t p=fork();int status=0;if(p<0)return 0;
    if(!p){struct rlimit lim={bytes,bytes};setpgid(0,0);setrlimit(RLIMIT_FSIZE,&lim);
        int fd=open("/dev/null",O_RDWR);if(fd<0)_exit(126);dup2(fd,0);dup2(fd,1);dup2(fd,2);if(fd>2)close(fd);execvp(args[0],args);_exit(127);}
    setpgid(p,p);long long end=mx_ms()+seconds*1000LL;
    for(;;){pid_t r=waitpid(p,&status,WNOHANG);if(r==p)return WIFEXITED(status)&&WEXITSTATUS(status)==0;if(r<0&&errno!=EINTR)return 0;
        if(mx_ms()>=end){kill(-p,SIGKILL);while(waitpid(p,&status,0)<0&&errno==EINTR){}return 0;}usleep(50000);}
}
static int mx_run(char *const args[],int seconds){return mx_run_limit(args,seconds,64*1024*1024);}
static int mx_write(const char *path,const char *s)
{
    int fd=open(path,O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW|O_CLOEXEC,0600);if(fd<0)return 0;size_t n=strlen(s),off=0;
    while(off<n){ssize_t k=write(fd,s+off,n-off);if(k<0&&errno==EINTR)continue;if(k<=0){close(fd);return 0;}off+=(size_t)k;}int ok=fsync(fd)==0;close(fd);return ok;
}
static char *mx_read(const char *path,size_t limit)
{
    int fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);struct stat st;if(fd<0)return NULL;
    if(fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_size<0||(size_t)st.st_size>limit){close(fd);return NULL;}
    char *buf=malloc((size_t)st.st_size+1);if(!buf){close(fd);return NULL;}size_t n=0;
    while(n<(size_t)st.st_size){ssize_t k=read(fd,buf+n,(size_t)st.st_size-n);if(k<0&&errno==EINTR)continue;if(k<=0){free(buf);close(fd);return NULL;}n+=(size_t)k;}buf[n]=0;close(fd);if(memchr(buf,0,n)){free(buf);return NULL;}return buf;
}
/* Common top-level scalar YAML only. Unsupported multiline/alias forms fail closed. */
static int mx_scalar(char *v,char *out,size_t cap)
{
    v=(char *)mx_ws(v);char *end=v+strlen(v);while(end>v&&isspace((unsigned char)end[-1]))*--end=0;
    if(*v=='"'){mxj j=mx_parse(v);if(j.p)return mx_text(j,out,cap);/* trailing YAML comment */
        const char *e=mx_scan(v,0);if(e && (*mx_ws(e)=='#'||!*mx_ws(e)))return mx_text((mxj){v,e},out,cap);return 0;}
    if(*v=='\''){char *p=v+1;size_t n=0;while(*p){if(*p=='\''){if(p[1]=='\'')p++;else{p++;if(*mx_ws(p)&&*mx_ws(p)!='#')return 0;out[n]=0;return 1;}}
            if((unsigned char)*p<32||n+1>=cap)return 0;out[n++]=*p++;}return 0;}
    if(*v && strchr("|>&*!{[",*v))return 0;
    for(char *p=v;*p;p++)if(*p=='#'&&(p==v||isspace((unsigned char)p[-1]))){end=p;break;}
    while(end>v&&isspace((unsigned char)end[-1]))end--;size_t n=(size_t)(end-v);if(n>=cap)return 0;
    memcpy(out,v,n);out[n]=0;for(size_t i=0;i<n;i++)if((unsigned char)out[i]<32)return 0;return 1;
}
static int mx_config(const char *dir,char *base,size_t cap,char *secret,size_t sc)
{
    char path[512],line[4096],controller[256]="";int seen=0,secseen=0,ok=1;secret[0]=0;
    snprintf(path,sizeof path,"%s/config.yaml",dir);FILE *fp=fopen(path,"r");if(!fp)return 0;
    while(fgets(line,sizeof line,fp)){if(!strchr(line,'\n')&&!feof(fp)){ok=0;break;}
        if(!strncmp(line,"external-controller:",20)){if(seen++||!mx_scalar(line+20,controller,sizeof controller))ok=0;}
        if(!strncmp(line,"secret:",7)){if(secseen++||!mx_scalar(line+7,secret,sc))ok=0;}}
    fclose(fp);if(!ok||!seen||!controller[0])return 0;
    char *port=strrchr(controller,':');if(!port)return 0;*port++=0;char *end;long n=strtol(port,&end,10);
    if(!*port||*end||n<1||n>65535)return 0;
    if(!strcmp(controller,"[::]")||!strcmp(controller,"[::1]"))snprintf(base,cap,"http://[::1]:%ld",n);
    else if(!*controller||!strcmp(controller,"127.0.0.1")||!strcmp(controller,"localhost")||!strcmp(controller,"0.0.0.0"))snprintf(base,cap,"http://127.0.0.1:%ld",n);
    else return 0;return 1;
}
static int mx_encode(const char *s,char *out,size_t cap,int json)
{
    static const char hex[]="0123456789ABCDEF";size_t n=0;if(json){if(cap<3)return 0;out[n++]='"';}
    for(;*s;s++){unsigned char c=(unsigned char)*s;if(c<32||c==127)return 0;
        if(json){if(n+3>=cap)return 0;if(c=='"'||c=='\\')out[n++]='\\';out[n++]=(char)c;}
        else if((isalnum(c)&&c<128) || c=='-'||c=='_'||c=='.'||c=='~'){if(n+2>=cap)return 0;out[n++]=(char)c;}
        else {if(n+4>=cap)return 0;out[n++]='%';out[n++]=hex[c>>4];out[n++]=hex[c&15];}}
    if(json)out[n++]='"';out[n]=0;return 1;
}
static int mx_hex(const char *s,char *out,size_t cap)
{size_t n=strlen(s);if(n*2+1>cap)return 0;for(size_t i=0;i<n;i++)sprintf(out+i*2,"%02x",(unsigned char)s[i]);out[n*2]=0;return 1;}
static int mx_unhex(const char *s,size_t n,char *out,size_t cap)
{if(!n||n%2||n/2>=cap)return 0;for(size_t i=0;i<n;i+=2){if(!isxdigit((unsigned char)s[i])||!isxdigit((unsigned char)s[i+1]))return 0;char b[3]={s[i],s[i+1],0};int c=(int)strtol(b,NULL,16);if(c<32||c==127)return 0;out[i/2]=(char)c;}out[n/2]=0;return 1;}
static char *mx_api(const char *dir,const char *method,const char *path,const char *payload,int seconds)
{
    char base[128],secret[2048],url[8192],tmp[]="/tmp/devui-mh-http-XXXXXX",header[128],body[128],output[128],auth[2200],timeval[16];char *result=NULL;
    if(!mx_config(dir,base,sizeof base,secret,sizeof secret)){snprintf(mx_error,sizeof mx_error,"控制器配置不可用：需本机 external-controller 和普通 secret 标量");return NULL;}
    if(snprintf(url,sizeof url,"%s%s",base,path)>=(int)sizeof url||!mkdtemp(tmp))return NULL;
    snprintf(header,sizeof header,"%s/header",tmp);snprintf(body,sizeof body,"%s/body",tmp);snprintf(output,sizeof output,"%s/result",tmp);
    snprintf(auth,sizeof auth,"Content-Type: application/json\nAuthorization: Bearer %s\n",secret);memset(secret,0,sizeof secret);
    if(!mx_write(header,auth)||!mx_write(body,payload?payload:""))goto done;memset(auth,0,sizeof auth);
    char harg[140],barg[140];snprintf(harg,sizeof harg,"@%s",header);snprintf(barg,sizeof barg,"@%s",body);snprintf(timeval,sizeof timeval,"%d",seconds);
    char *args[32]={"curl","-q","--silent","--show-error","--fail","--noproxy","*","--connect-timeout","3","--max-time",timeval,"--max-filesize","2097152","-X",(char *)method,"-H",harg,"-o",output,"--url",url,NULL,NULL,NULL};
    if(payload){int n=0;while(args[n])n++;args[n++]="--data-binary";args[n++]=barg;args[n]=NULL;}
    if(!mx_run_limit(args,seconds+2,MX_LIMIT)){snprintf(mx_error,sizeof mx_error,"API 请求失败：检查 curl、核心运行状态、认证及控制器端口");goto done;}
    result=mx_read(output,MX_LIMIT);if(!result)snprintf(mx_error,sizeof mx_error,"API 响应过大或读取失败");
 done:unlink(header);unlink(body);unlink(output);rmdir(tmp);return result;
}
static int mx_snapshot(const char *dir)
{
    char *s=mx_api(dir,"GET","/proxies",NULL,12);if(!s)return 0;mxj root=mx_parse(s),proxies=mx_field(root,"proxies");int ok=proxies.p&&*proxies.p=='{';
    if(ok){char tmp[640];snprintf(tmp,sizeof tmp,"%s.XXXXXX",MX_CACHE);int fd=mkstemp(tmp);if(fd<0)ok=0;else{close(fd);ok=mx_write(tmp,s)&&rename(tmp,MX_CACHE)==0;unlink(tmp);}}
    if(!ok)snprintf(mx_error,sizeof mx_error,"节点响应无效或缓存写入失败");free(s);return ok;
}
static int mx_member(mxj group,const char *node)
{mxj all=mx_field(group,"all");int n=mx_count(all);char name[MX_NAME];for(int i=0;i<n;i++)if(mx_text(mx_at(all,i),name,sizeof name)&&!strcmp(name,node))return 1;return 0;}
#include "mihomo_data.h"
static int mx_worker(const char *verb)
{
    int fd=mh_lock_open(),ok=0;if(fd<0)return 73;if(flock(fd,LOCK_EX|LOCK_NB)){close(fd);return 75;}
    const struct plugin_candidate *p=plugin_script_select(g_mh_candidates,ARRAY_LEN(g_mh_candidates),0);
    mx_error[0]=0;mh_worker_log("扩展操作","","正在执行，请勿重复提交",0);
    if(!p){snprintf(mx_error,sizeof mx_error,"找不到已安装的代理插件");goto done;}
    if(!strcmp(verb,"mxrefresh")){ok=mx_snapshot(p->dir);goto done;}
    if(!strcmp(verb,"mxupdate")){ok=mx_update(p->dir);goto done;}
    if(!strncmp(verb,"mxgroup:",8)){
        char name[MX_NAME],encoded[MX_NAME*3],path[MX_NAME*3+256],type[64];
        if(!mx_unhex(verb+8,strlen(verb+8),name,sizeof name)||!mx_encode(name,encoded,sizeof encoded,0))goto done;
        snprintf(path,sizeof path,"/proxies/%s",encoded);char *groupdata=mx_api(p->dir,"GET",path,NULL,12);if(!groupdata)goto done;
        mxj g=mx_parse(groupdata),all=mx_field(g,"all");int count=mx_count(all),success=0;
        if(!mx_text(mx_field(g,"type"),type,sizeof type)||strcmp(type,"Selector")||!count){free(groupdata);snprintf(mx_error,sizeof mx_error,"组测速仅支持非空 Selector，避免改变自动策略组的固定选择");goto done;}
        snprintf(path,sizeof path,"/group/%s/delay?url=http%%3A%%2F%%2Fwww.gstatic.com%%2Fgenerate_204&timeout=5000",encoded);
        char *result=mx_api(p->dir,"GET",path,NULL,15);if(!result){free(groupdata);goto done;}
        mxj delays=mx_parse(result);
        for(int i=0;i<count;i++){char node[MX_NAME],*end;long ms;
            if(!mx_text(mx_at(all,i),node,sizeof node))continue;mxj v=mx_field(delays,node);
            if(v.p&&*v.p>='0'&&*v.p<='9'){ms=strtol(v.p,&end,10);if(end==v.e&&ms>0&&ms<=60000)success++;}}
        free(groupdata);free(result);ok=success>0;
        if(ok)(void)mx_snapshot(p->dir);
        snprintf(mx_error,sizeof mx_error,"当前组测速：%d 个成功，%d 个失败/无结果；延迟记录见节点列表，不代表带宽",success,count-success);goto done;
    }
    int selecting=!strncmp(verb,"mxselect:",9),testing=!strncmp(verb,"mxtest:",7);
    if(!selecting&&!testing){snprintf(mx_error,sizeof mx_error,"未知操作");goto done;}
    const char *arg=verb+(selecting?9:7),*sep=strchr(arg,':');char group[MX_NAME],node[MX_NAME],encoded[MX_NAME*3],path[MX_NAME*3+256];
    if(!sep||!mx_unhex(arg,(size_t)(sep-arg),group,sizeof group)||!mx_unhex(sep+1,strlen(sep+1),node,sizeof node)||!mx_encode(group,encoded,sizeof encoded,0)){snprintf(mx_error,sizeof mx_error,"节点参数无效");goto done;}
    snprintf(path,sizeof path,"/proxies/%s",encoded);char *s=mx_api(p->dir,"GET",path,NULL,12);if(!s)goto done;
    mxj g=mx_parse(s);char type[64];int member=mx_member(g,node),selector=mx_text(mx_field(g,"type"),type,sizeof type)&&!strcmp(type,"Selector");free(s);
    if(!member || (selecting&&!selector)){snprintf(mx_error,sizeof mx_error,"节点已变更或策略组不可手动选择，请刷新");goto done;}
    if(selecting){char quoted[MX_NAME*2+4],payload[MX_NAME*2+32];if(!mx_encode(node,quoted,sizeof quoted,1))goto done;
        snprintf(payload,sizeof payload,"{\"name\":%s}",quoted);s=mx_api(p->dir,"PUT",path,payload,12);if(!s)goto done;free(s);
        s=mx_api(p->dir,"GET",path,NULL,12);if(!s)goto done;char now[MX_NAME];ok=mx_text(mx_field(mx_parse(s),"now"),now,sizeof now)&&!strcmp(now,node);free(s);
        snprintf(mx_error,sizeof mx_error,"%s",ok?"节点已切换，API 回读确认":"切换后的节点与请求不一致，请刷新检查");
    }else{if(!mx_encode(node,encoded,sizeof encoded,0))goto done;
        snprintf(path,sizeof path,"/proxies/%s/delay?url=http%%3A%%2F%%2Fwww.gstatic.com%%2Fgenerate_204&timeout=5000",encoded);
        s=mx_api(p->dir,"GET",path,NULL,9);if(!s)goto done;mxj delay=mx_field(mx_parse(s),"delay");char *end;long ms=delay.p?strtol(delay.p,&end,10):-1;
        ok=delay.p&&*delay.p>='0'&&*delay.p<='9'&&end==delay.e&&ms>0&&ms<=60000;
        snprintf(mx_error,sizeof mx_error,ok?"节点延迟：%ld ms（HTTP 连通性测试，非带宽测速）":"节点测速失败/超时（未返回有效延迟）",ms);free(s);}
    if(ok){char saved[256];snprintf(saved,sizeof saved,"%s",mx_error);if(!mx_snapshot(p->dir))strncat(saved,"；列表刷新失败，请手动刷新",sizeof saved-strlen(saved)-1);snprintf(mx_error,sizeof mx_error,"%s",saved);}
 done:mh_worker_log(!strcmp(verb,"mxupdate")?"数据更新":"节点操作","",mx_error[0]?mx_error:ok?"操作完成":"操作失败",ok?0:1);close(fd);return ok?0:1;
}
#endif
