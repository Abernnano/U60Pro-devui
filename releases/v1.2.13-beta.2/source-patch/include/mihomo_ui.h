/* Small-screen node browser: four rows/page; no browser JavaScript required. */
#ifndef DEVUI_MIHOMO_UI_H
#define DEVUI_MIHOMO_UI_H
#include <stdarg.h>
static char *mx_doc;
static struct stat mx_stamp;
static int mx_group_index,mx_page,mx_confirm;
static char mx_markup[40000];
static void mx_append(const char *fmt,...)
{size_t n=strlen(mx_markup);if(n>=sizeof mx_markup-1)return;va_list ap;va_start(ap,fmt);vsnprintf(mx_markup+n,sizeof mx_markup-n,fmt,ap);va_end(ap);}
static void mx_load_cache(void)
{
    struct stat st;if(lstat(MX_CACHE,&st)||!S_ISREG(st.st_mode)){free(mx_doc);mx_doc=NULL;return;}
    if(mx_doc&&st.st_ino==mx_stamp.st_ino&&st.st_mtime==mx_stamp.st_mtime&&st.st_size==mx_stamp.st_size)return;
    char *s=mx_read(MX_CACHE,MX_LIMIT);if(!s||!mx_parse(s).p){free(s);free(mx_doc);mx_doc=NULL;return;}
    free(mx_doc);mx_doc=s;mx_stamp=st;
}
static const char *mx_ui(void)
{
    mx_load_cache();mx_markup[0]=0;
    mx_append("<div class=\"mh-controls\"><a class=\"svc-btn mh-action\" href=\"act:mxrefresh\">刷新策略组 / 节点</a><a class=\"svc-btn mh-action\" href=\"act:mxaskupdate\">一键更新数据文件</a></div>");
    if(mx_confirm)mx_append("<p class=\"func-note\">将下载并校验 4 个数据文件及版本文件。失败保留旧文件；不会自动重启代理。</p><div class=\"mh-controls\"><a class=\"svc-btn mh-action\" href=\"act:mxupdate\">确认更新</a><a class=\"svc-btn mh-action\" href=\"act:mxcancel\">取消</a></div>");
    if(!mx_doc){mx_append("<p class=\"func-note\">先启动代理，再点击刷新。这里显示核心实际返回的策略组，不使用演示节点。</p>");return mx_markup;}
    char group[MX_NAME],now[MX_NAME]="-",type[128]="未知",escaped[MX_NAME*6],other[MX_NAME*6];
    mxj root=mx_parse(mx_doc),g=mx_group(root,mx_group_index,group,sizeof group);
    if(!g.p){mx_group_index=mx_page=0;g=mx_group(root,0,group,sizeof group);}
    if(!g.p){mx_append("<p class=\"func-note\">API 未返回可浏览的策略组；请检查代理配置。</p>");return mx_markup;}
    mx_text(mx_field(g,"now"),now,sizeof now);mx_text(mx_field(g,"type"),type,sizeof type);html_esc(escaped,sizeof escaped,group);html_esc(other,sizeof other,now);
    long age=(long)(time(NULL)-mx_stamp.st_mtime);int stale=age<0||age>300;
    mx_append("<p class=\"func-note\">%s；列表采集于 %ld 秒前。</p><div class=\"mh-node-name\">策略组：%s</div><p class=\"func-note\">当前选择：%s</p>",stale?"列表已过期，请先刷新":"列表来自本机 API",age<0?0:age,escaped,other);
    html_esc(escaped,sizeof escaped,type);mx_append("<p class=\"func-note\">类型：%s%s</p>",escaped,strcmp(type,"Selector")?"（自动策略组只读；请在 Selector 组手动切换）":"");
    mx_append("<div class=\"mh-controls\"><a class=\"svc-btn mh-action\" href=\"act:mxgprev\">上一策略组</a><a class=\"svc-btn mh-action\" href=\"act:mxgnext\">下一策略组</a></div>");
    if(!strcmp(type,"Selector"))mx_append("<a class=\"svc-btn mh-action\" href=\"act:mxgroup\">当前组一键测速</a>");
    mxj all=mx_field(g,"all");int n=mx_count(all);if(mx_page*4>=n)mx_page=0;
    for(int i=mx_page*4;i<n&&i<mx_page*4+4;i++){
        char name[MX_NAME];if(!mx_text(mx_at(all,i),name,sizeof name)){mx_append("<p class=\"func-note\">名称过长或无效，已禁用该节点</p>");continue;}
        html_esc(escaped,sizeof escaped,name);mx_append("<div class=\"mh-node\"><div class=\"mh-node-name\">%s%s</div>",!strcmp(name,now)?"✓ ":"",escaped);
        mxj proxy=mx_field(mx_field(root,"proxies"),name),history=mx_field(proxy,"history");int hn=mx_count(history);mxj delay=mx_field(mx_at(history,hn-1),"delay");char *end;long ms=delay.p?strtol(delay.p,&end,10):-1;
        if(delay.p&&end==delay.e&&ms>0&&ms<=60000)mx_append("<span class=\"func-note\">历史延迟 %ld ms（非本次测速）</span>",ms);
        mx_append("<div class=\"mh-controls\">");if(!strcmp(type,"Selector"))mx_append("<a class=\"svc-btn mh-action\" href=\"act:mxselect:%d\">切换到此节点</a>",i);
        mx_append("<a class=\"svc-btn mh-action\" href=\"act:mxtest:%d\">节点测速</a></div></div>",i);
    }
    mx_append("<p class=\"func-note\">第 %d / %d 页 · 共 %d 个成员。测速结果见下方操作日志；测量 HTTP 延迟，不是下载带宽。</p>",mx_page+1,n?(n+3)/4:1,n);
    mx_append("<div class=\"mh-controls\"><a class=\"svc-btn mh-action\" href=\"act:mxprev\">上一页节点</a><a class=\"svc-btn mh-action\" href=\"act:mxnext\">下一页节点</a></div>");return mx_markup;
}
static int mx_action(const char *a,char *message,size_t cap)
{
    if(strncmp(a,"mx",2))return 0;snprintf(message,cap,"页面已更新");
    if(!strcmp(a,"mxaskupdate")){mx_confirm=1;return 1;}if(!strcmp(a,"mxcancel")){mx_confirm=0;return 1;}
    if(!strcmp(a,"mxrefresh")||!strcmp(a,"mxupdate")){
        if(!strcmp(a,"mxupdate")&&!mx_confirm){snprintf(message,cap,"请先确认数据文件更新");return 1;}
        int rc=mh_submit(a);if(!rc)mx_confirm=0;snprintf(message,cap,"%s",rc?"提交失败或已有操作正在执行":"已提交后台任务，结果见操作日志");return 1;}
    if(!mx_doc){snprintf(message,cap,"请先刷新节点列表");return 1;}
    char group[MX_NAME],node[MX_NAME];mxj root=mx_parse(mx_doc),g=mx_group(root,mx_group_index,group,sizeof group);int count=mx_count(mx_field(g,"all"));
    if(!strcmp(a,"mxgprev")){if(mx_group_index>0)mx_group_index--;mx_page=0;return 1;}
    if(!strcmp(a,"mxgnext")){if(mx_group(root,mx_group_index+1,node,sizeof node).p)mx_group_index++;mx_page=0;return 1;}
    if(!strcmp(a,"mxprev")){if(mx_page>0)mx_page--;return 1;}
    if(!strcmp(a,"mxnext")){if((mx_page+1)*4<count)mx_page++;return 1;}
    if(!strcmp(a,"mxgroup")){
        long age=(long)(time(NULL)-mx_stamp.st_mtime);char gh[MX_NAME*2],verb[MX_NAME*2+16];
        if(!g.p||age<0||age>300||!mx_hex(group,gh,sizeof gh)){snprintf(message,cap,"请先刷新节点列表");return 1;}
        snprintf(verb,sizeof verb,"mxgroup:%s",gh);int rc=mh_submit(verb);
        snprintf(message,cap,"%s",rc?"已有操作执行中或提交失败":"当前组测速已提交，请查看日志");return 1;
    }
    int select=!strncmp(a,"mxselect:",9),test=!strncmp(a,"mxtest:",7);if(!select&&!test){snprintf(message,cap,"未知操作");return 1;}
    long age=(long)(time(NULL)-mx_stamp.st_mtime);if(age<0||age>300){snprintf(message,cap,"列表已过期，请先刷新");return 1;}
    const char *number=a+(select?9:7);char *end;long idx=strtol(number,&end,10);
    if(!isdigit((unsigned char)*number)||*end||idx<0||idx>=count||!mx_text(mx_at(mx_field(g,"all"),(int)idx),node,sizeof node)){snprintf(message,cap,"节点索引无效，请刷新");return 1;}
    char gh[MX_NAME*2],nh[MX_NAME*2],verb[MX_NAME*4+32];
    if(!mx_hex(group,gh,sizeof gh)||!mx_hex(node,nh,sizeof nh)){snprintf(message,cap,"节点名称过长");return 1;}
    snprintf(verb,sizeof verb,"%s:%s:%s",select?"mxselect":"mxtest",gh,nh);int rc=mh_submit(verb);
    snprintf(message,cap,"%s",rc?"已有操作执行中或提交失败":"已提交；后台校验节点并执行，请查看日志");return 1;
}
#endif
